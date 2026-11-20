import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { MongoClient } from "mongodb";

const app = express();
const ORIGEN_WEB = "https://gabosahur.github.io";
app.use(cors({ origin: [ORIGEN_WEB, "http://127.0.0.1:5500", "http://localhost:5500"] }));
app.use(express.json());

const cliente = new MongoClient(process.env.MONGO_URI);
await cliente.connect();
const db = cliente.db("numerax");

await db.collection("usuarios").createIndex({ usuario: 1 }, { unique: true });
await db.collection("sesiones").createIndex({ token: 1 }, { unique: true });

// ---------- Utilidades de contraseña y sesión (sin dependencias extra) ----------
function hashClave(clave) {
  const sal = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(clave, sal, 64).toString("hex");
  return `${sal}:${hash}`;
}

function claveCorrecta(clave, guardada) {
  const [sal, hash] = guardada.split(":");
  const comparar = crypto.scryptSync(clave, sal, 64);
  return crypto.timingSafeEqual(comparar, Buffer.from(hash, "hex"));
}

async function crearSesion(usuario, rol = "jugador") {
  const token = crypto.randomBytes(32).toString("hex");
  await db.collection("sesiones").insertOne({ token, usuario, rol, creada: new Date() });
  return token;
}

async function sesionDesdeRequest(req) {
  const cabecera = req.headers.authorization || "";
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : null;
  if (!token) return null;
  return db.collection("sesiones").findOne({ token });
}

// ---------- Ruta de prueba ----------
app.get("/", (req, res) => res.send("API de NumeraX funcionando"));

// ---------- Registro e ingreso de jugadores ----------
app.post("/api/registro", async (req, res) => {
  const usuario = String(req.body.usuario || "").trim();
  const clave = String(req.body.clave || "");

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(usuario))
    return res.status(400).json({ error: "El usuario debe tener entre 3 y 20 letras, números o guiones bajos." });
  if (clave.length < 6)
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });

  try {
    await db.collection("usuarios").insertOne({ usuario, clave: hashClave(clave), creado: new Date() });
    const token = await crearSesion(usuario);
    res.status(201).json({ token, usuario });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "Ese nombre de usuario ya existe." });
    throw error;
  }
});

app.post("/api/ingresar", async (req, res) => {
  const usuario = String(req.body.usuario || "").trim();
  const clave = String(req.body.clave || "");

  const cuenta = await db.collection("usuarios").findOne({ usuario });
  if (!cuenta || !claveCorrecta(clave, cuenta.clave))
    return res.status(401).json({ error: "Usuario o contraseña incorrectos." });

  const token = await crearSesion(usuario);
  res.json({ token, usuario });
});

app.post("/api/salir", async (req, res) => {
  const cabecera = req.headers.authorization || "";
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  await db.collection("sesiones").deleteOne({ token });
  res.json({ ok: true });
});

app.get("/api/yo", async (req, res) => {
  const sesion = await sesionDesdeRequest(req);
  if (!sesion) return res.status(401).json({ error: "No hay sesión." });
  res.json({ usuario: sesion.usuario, rol: sesion.rol });
});

// ---------- Partidas y ranking ----------
app.post("/api/partidas", async (req, res) => {
  const { nivel, puntaje, correctas, incorrectas } = req.body;
  if (typeof puntaje !== "number") return res.status(400).json({ error: "Puntaje inválido" });

  const sesion = await sesionDesdeRequest(req);
  const usuario = sesion && sesion.rol === "jugador" ? sesion.usuario : null;

  await db.collection("partidas").insertOne({
    usuario,
    nombre: usuario || "Anónimo",
    nivel,
    puntaje,
    correctas,
    incorrectas,
    fecha: new Date(),
  });
  res.status(201).json({ ok: true, guardadaComo: usuario || "Anónimo" });
});

// Inicio del período según la hora de Uruguay (UTC-3)
function inicioPeriodo(periodo) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Montevideo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => Number(partes.find((p) => p.type === t).value);
  const y = get("year"), m = get("month"), d = get("day");
  const medianocheUY = Date.UTC(y, m - 1, d) + 3 * 60 * 60 * 1000;

  if (periodo === "diario") return new Date(medianocheUY);
  if (periodo === "semanal") {
    const diaSemana = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    return new Date(medianocheUY - diaSemana * 24 * 60 * 60 * 1000);
  }
  if (periodo === "mensual") return new Date(Date.UTC(y, m - 1, 1) + 3 * 60 * 60 * 1000);
  return null;
}

// Ranking: mejor puntaje de cada jugador registrado, hasta 50
app.get("/api/ranking", async (req, res) => {
  const periodo = String(req.query.periodo || "historico");
  const inicio = inicioPeriodo(periodo);
  const filtro = { usuario: { $ne: null } };
  if (inicio) filtro.fecha = { $gte: inicio };

  const top = await db
    .collection("partidas")
    .aggregate([
      { $match: filtro },
      { $sort: { puntaje: -1 } },
      {
        $group: {
          _id: "$usuario",
          nombre: { $first: "$usuario" },
          nivel: { $first: "$nivel" },
          puntaje: { $first: "$puntaje" },
          correctas: { $first: "$correctas" },
          incorrectas: { $first: "$incorrectas" },
          fecha: { $first: "$fecha" },
        },
      },
      { $sort: { puntaje: -1 } },
      { $limit: 50 },
      { $project: { _id: 0 } },
    ])
    .toArray();

  res.json(top);
});

// ---------- Contacto ----------
app.post("/api/contacto", async (req, res) => {
  const { nombre, email, mensaje } = req.body;
  await db.collection("mensajes").insertOne({ nombre, email, mensaje, fecha: new Date() });
  res.status(201).json({ ok: true });
});

// ---------- Administración (protegida) ----------
app.post("/api/admin/ingresar", async (req, res) => {
  const usuario = String(req.body.usuario || "");
  const clave = String(req.body.clave || "");
  if (usuario !== process.env.ADMIN_USUARIO || clave !== process.env.ADMIN_CLAVE)
    return res.status(401).json({ error: "Usuario o contraseña incorrectos." });

  const token = await crearSesion(usuario, "admin");
  res.json({ token, usuario });
});

async function exigirAdmin(req, res, siguiente) {
  const sesion = await sesionDesdeRequest(req);
  if (!sesion || sesion.rol !== "admin") return res.status(403).json({ error: "Acceso restringido." });
  siguiente();
}

app.get("/api/admin/mensajes", exigirAdmin, async (req, res) => {
  const mensajes = await db.collection("mensajes").find({}).sort({ fecha: -1 }).toArray();
  res.json(mensajes);
});

app.get("/api/admin/partidas", exigirAdmin, async (req, res) => {
  const partidas = await db.collection("partidas").find({}).sort({ fecha: -1 }).limit(200).toArray();
  res.json(partidas);
});


// ---------- Perfil del jugador ----------
const REGEX_USUARIO = /^[a-zA-Z0-9_]{3,20}$/;

async function jugadorDesdeRequest(req) {
  const sesion = await sesionDesdeRequest(req);
  return sesion && sesion.rol === "jugador" ? sesion : null;
}

app.get("/api/perfil", async (req, res) => {
  const sesion = await jugadorDesdeRequest(req);
  if (!sesion) return res.status(401).json({ error: "Iniciá sesión para ver tu perfil." });

  const cuenta = await db.collection("usuarios").findOne({ usuario: sesion.usuario });
  if (!cuenta) return res.status(404).json({ error: "Cuenta no encontrada." });

  res.json({ usuario: cuenta.usuario, descripcion: cuenta.descripcion || "", foto: cuenta.foto || "", creado: cuenta.creado });
});

app.put("/api/perfil", async (req, res) => {
  const sesion = await jugadorDesdeRequest(req);
  if (!sesion) return res.status(401).json({ error: "Iniciá sesión para editar tu perfil." });

  const anterior = sesion.usuario;
  const nuevo = String(req.body.usuario ?? anterior).trim();
  const descripcion = String(req.body.descripcion ?? "").trim().slice(0, 200);

  if (!REGEX_USUARIO.test(nuevo))
    return res.status(400).json({ error: "El usuario debe tener entre 3 y 20 letras, números o guion bajo." });

  const campos = { descripcion };
  if (req.body.foto !== undefined) {
    const foto = String(req.body.foto || "");
    if (foto !== "" && (!/^data:image\/(jpeg|png|webp);base64,/.test(foto) || foto.length > 200000))
      return res.status(400).json({ error: "La foto tiene que ser una imagen chica (JPG, PNG o WebP)." });
    campos.foto = foto;
  }

  try {
    if (nuevo !== anterior) {
      campos.usuario = nuevo;
      await db.collection("usuarios").updateOne({ usuario: anterior }, { $set: campos });
      // Mantener el mismo nombre en partidas y sesiones abiertas
      await db.collection("partidas").updateMany({ usuario: anterior }, { $set: { usuario: nuevo, nombre: nuevo } });
      await db.collection("sesiones").updateMany({ usuario: anterior }, { $set: { usuario: nuevo } });
    } else {
      await db.collection("usuarios").updateOne({ usuario: anterior }, { $set: campos });
    }
    const cuenta = await db.collection("usuarios").findOne({ usuario: nuevo });
    res.json({ usuario: nuevo, descripcion, foto: cuenta.foto || "" });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "Ese nombre de usuario ya existe." });
    throw error;
  }
});

// Perfil público: lo ven otros jugadores
app.get("/api/jugadores/:usuario", async (req, res) => {
  const cuenta = await db.collection("usuarios").findOne({ usuario: req.params.usuario });
  if (!cuenta) return res.status(404).json({ error: "Jugador no encontrado." });

  const partidas = await db
    .collection("partidas")
    .find({ usuario: cuenta.usuario }, { projection: { _id: 0, nivel: 1, puntaje: 1, fecha: 1 } })
    .sort({ puntaje: -1 })
    .limit(10)
    .toArray();

  res.json({
    usuario: cuenta.usuario,
    descripcion: cuenta.descripcion || "",
    foto: cuenta.foto || "",
    creado: cuenta.creado,
    partidas,
  });
});



app.listen(process.env.PORT || 3000, () =>
  console.log(`Servidor en http://localhost:${process.env.PORT || 3000}`)
);
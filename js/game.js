/**
 * game.js
 * -----------------------------------------------------------
 * Motor del juego de matemática.
 * -----------------------------------------------------------
 */

import { CONTENT_LIBRARY } from "./content-library.js";
import { generarEjercicioFracciones } from "./generadores/fracciones.js";
import { generarEjercicioDecimales } from "./generadores/decimales.js";
import { generarEjercicioPorcentajes } from "./generadores/porcentajes.js";

const DURACION_PARTIDA = 60;

const adaptiveEngine = {
  nivelDificultad: 2,
  rachaAciertos: 0,
  rachaErrores: 0,

  registrarResultado(esCorrecto) {
    if (esCorrecto) {
      this.rachaAciertos++;
      this.rachaErrores = 0;
      if (this.rachaAciertos >= 3) {
        this.nivelDificultad = Math.min(5, this.nivelDificultad + 1);
        this.rachaAciertos = 0;
      }
    } else {
      this.rachaErrores++;
      this.rachaAciertos = 0;
      if (this.rachaErrores >= 2) {
        this.nivelDificultad = Math.max(1, this.nivelDificultad - 1);
        this.rachaErrores = 0;
      }
    }
  },

  factorRango() {
    return 1 + (this.nivelDificultad - 1) * 0.6;
  },
};

let estado = {
  nivelKey: "suma",
  puntaje: 0,
  correctas: 0,
  incorrectas: 0,
  racha: 0,
  problemaActual: null,
  tiempoRestante: DURACION_PARTIDA,
  intervalo: null,
  jugando: false,
};

document.addEventListener("DOMContentLoaded", () => {
  if (!document.querySelector(".game-shell")) return;
  inicializarJuego();
});

function inicializarJuego() {
  const params = new URLSearchParams(window.location.search);
  const nivelKey = params.get("nivel");

  estado.nivelKey = CONTENT_LIBRARY[nivelKey] ? nivelKey : "suma";

  const nivel = CONTENT_LIBRARY[estado.nivelKey];
  document.querySelectorAll("[data-nivel-titulo]").forEach((el) => {
    el.textContent = nivel.titulo;
  });

  document
    .getElementById("form-respuesta")
    .addEventListener("submit", manejarRespuesta);

  document
    .getElementById("btn-jugar-de-nuevo")
    ?.addEventListener("click", () => window.location.reload());

  iniciarPartida();
}

function iniciarPartida() {
  estado.puntaje = 0;
  estado.correctas = 0;
  estado.incorrectas = 0;
  estado.racha = 0;
  estado.tiempoRestante = DURACION_PARTIDA;
  estado.jugando = true;

  actualizarPlacar();
  generarProblema();
  iniciarTemporizador();

  document.getElementById("pantalla-juego").classList.remove("hidden");
  document.getElementById("pantalla-resultado").classList.add("hidden");
}

function iniciarTemporizador() {
  clearInterval(estado.intervalo);
  actualizarTimer();
  estado.intervalo = setInterval(() => {
    estado.tiempoRestante--;
    actualizarTimer();
    if (estado.tiempoRestante <= 0) {
      finalizarPartida();
    }
  }, 1000);
}

function actualizarTimer() {
  const el = document.getElementById("timer");
  if (el) el.textContent = `${estado.tiempoRestante}s`;
}

function generarProblema() {
  const operacion =
    estado.nivelKey === "mixto"
      ? ["suma", "resta", "multiplicacion", "division"][
          Math.floor(Math.random() * 4)
        ]
      : estado.nivelKey;

  const config = CONTENT_LIBRARY[operacion];
  const factor = adaptiveEngine.factorRango();
  const min = config.min;
  const max = Math.round(config.max * factor);

  let a = aleatorioEntre(min, max);
  let b = aleatorioEntre(min, max);
  let resultado;

  switch (operacion) {
    case "suma":
      resultado = a + b;
      break;
    case "resta":
      if (b > a) [a, b] = [b, a];
      resultado = a - b;
      break;
    case "multiplicacion":
      resultado = a * b;
      break;
    case "division":
      b = aleatorioEntre(min, Math.max(min + 1, Math.round(6 * factor)));
      resultado = aleatorioEntre(min, Math.round(10 * factor));
      a = b * resultado;
      break;
  }

  estado.problemaActual = {
    a,
    b,
    operacion,
    simbolo: CONTENT_LIBRARY[operacion].simbolo,
    resultado,
  };

  document.getElementById(
    "expresion"
  ).textContent = `${a} ${CONTENT_LIBRARY[operacion].simbolo} ${b}`;
  if (vozActivada) leerEnVoz(`${a} ${CONTENT_LIBRARY[operacion].simbolo} ${b}`);

  const input = document.getElementById("input-respuesta");
  input.value = "";
  input.focus();

  ocultarFeedback();
}

function manejarRespuesta(evento) {
  evento.preventDefault();
  if (!estado.jugando) return;

  const input = document.getElementById("input-respuesta");
  const valorIngresado = Number(input.value);
  if (input.value.trim() === "" || Number.isNaN(valorIngresado)) {
    mostrarFeedback("Escribí un número antes de responder.", false);
    return;
  }

  const esCorrecto = valorIngresado === estado.problemaActual.resultado;
  adaptiveEngine.registrarResultado(esCorrecto);

  if (esCorrecto) {
    estado.correctas++;
    estado.racha++;
    const puntosPorDificultad = 10 * adaptiveEngine.nivelDificultad;
    estado.puntaje += puntosPorDificultad;
    mostrarFeedback(`¡Correcto! +${puntosPorDificultad} pts`, true);
  } else {
    estado.incorrectas++;
    estado.racha = 0;
    mostrarFeedback(
      `Casi. La respuesta era ${estado.problemaActual.resultado}.`,
      false
    );
  }

  actualizarPlacar();

  setTimeout(() => {
    if (estado.jugando) generarProblema();
  }, esCorrecto ? 500 : 1600);
}

function actualizarPlacar() {
  document.getElementById("puntaje").textContent = estado.puntaje;
  document.getElementById("racha").textContent = `🔥 ${estado.racha}`;
  const nivelEl = document.getElementById("nivel-dificultad");
  if (nivelEl) nivelEl.textContent = adaptiveEngine.nivelDificultad;
}

function mostrarFeedback(mensaje, esCorrecto) {
  const el = document.getElementById("feedback");
  el.textContent = mensaje;
  el.classList.remove("ok", "bad");
  el.classList.add(esCorrecto ? "ok" : "bad");
}

function ocultarFeedback() {
  const el = document.getElementById("feedback");
  el.textContent = "";
  el.classList.remove("ok", "bad");
}

function finalizarPartida() {
  estado.jugando = false;
  clearInterval(estado.intervalo);

  document.getElementById("pantalla-juego").classList.add("hidden");
  const resultado = document.getElementById("pantalla-resultado");
  resultado.classList.remove("hidden");

  document.getElementById("resultado-puntaje").textContent = estado.puntaje;
  document.getElementById("resultado-correctas").textContent = estado.correctas;
  document.getElementById("resultado-incorrectas").textContent = estado.incorrectas;

  mostrarDatoCurioso(estado.puntaje || estado.correctas);

  document.dispatchEvent(
    new CustomEvent("numerax:partida-finalizada", {
      detail: { puntaje: estado.puntaje, nivel: CONTENT_LIBRARY[estado.nivelKey].titulo },
    })
  );
}

function aleatorioEntre(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Generadores de ejercicios específicos por tema
function generarEjercicioPorTema(tema) {
  switch (tema) {
    case "fracciones":
      return generarEjercicioFracciones();
    case "decimales":
      return generarEjercicioDecimales();
    case "porcentajes":
      return generarEjercicioPorcentajes();
    default:
      return null;
  }
}


/* ============================================================
   INTEGRACIONES: voz (Web Speech API) y dato curioso (local)
   ============================================================ */
let vozActivada = false;

const SIMBOLOS_VOZ = { "+": "más", "−": "menos", "-": "menos", "×": "por", "÷": "dividido" };

function obtenerVozEspanol() {
  const voces = speechSynthesis.getVoices();
  return (
    voces.find((v) => v.lang === "es-ES") ||
    voces.find((v) => v.lang.startsWith("es")) ||
    null
  );
}

function leerEnVoz(texto) {
  if (!("speechSynthesis" in window)) return;
  const frase = texto.replace(/[+\-−×÷]/g, (simbolo) => ` ${SIMBOLOS_VOZ[simbolo] || simbolo} `);
  speechSynthesis.cancel();
  // Chrome descarta una lectura que se pide justo después de cancelar: damos un respiro
  setTimeout(() => {
    const voz = new SpeechSynthesisUtterance(frase);
    const espanol = obtenerVozEspanol();
    if (espanol) voz.voice = espanol;
    voz.lang = "es-ES";
    voz.rate = 0.9;
    voz.onerror = (e) => console.warn("Error de voz:", e.error);
    speechSynthesis.speak(voz);
  }, 80);
}

function crearBotonVoz() {
  if (!("speechSynthesis" in window)) return;
  const barra = document.querySelector(".game-topbar");
  if (!barra) return;

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "pill";
  boton.setAttribute("aria-pressed", "false");
  boton.textContent = "🔇 Voz";
  boton.addEventListener("click", () => {
    vozActivada = !vozActivada;
    boton.textContent = vozActivada ? "🔊 Voz" : "🔇 Voz";
    boton.setAttribute("aria-pressed", String(vozActivada));
    if (!vozActivada) {
      speechSynthesis.cancel();
    } else {
      // Leer enseguida el ejercicio que está en pantalla
      leerEnVoz(document.getElementById("expresion")?.textContent || "");
    }
  });
  barra.append(boton);
}

const DATOS_CURIOSOS = [
  "el cero empezó a usarse como número en la India, alrededor del siglo V.",
  "el 2 es el único número primo par: todos los demás pares son divisibles por 2.",
  "multiplicar cualquier número por 10 le agrega un cero al final: 36 × 10 = 360.",
  "el signo = fue propuesto por el matemático Robert Recorde en 1557.",
  "para dividir por 5 también podés multiplicar por 2 y dividir por 10.",
  "una circunferencia tiene 360 grados, un número con muchos divisores.",
  "los hexágonos del panal de abejas son la forma que mejor aprovecha el espacio.",
  "un número es primo si solo es divisible por 1 y por sí mismo.",
];

function mostrarDatoCurioso(numero) {
  const contenedor = document.getElementById("pantalla-resultado");
  if (!contenedor) return;

  let dato = contenedor.querySelector(".dato-curioso");
  if (!dato) {
    dato = document.createElement("p");
    dato.className = "dato-curioso";
    dato.style.cssText = "font-style: italic; max-width: 520px; margin: 16px auto;";
    contenedor.querySelector(".hero-actions")?.before(dato);
  }

  // Dato local (sin red): el mismo puntaje siempre muestra el mismo dato
  const indice = Math.abs(Number(numero) || 0) % DATOS_CURIOSOS.length;
  dato.textContent = `Sabías que… ${DATOS_CURIOSOS[indice]}`;
}

if ("speechSynthesis" in window) {
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  speechSynthesis.getVoices();
}
document.addEventListener("DOMContentLoaded", crearBotonVoz);
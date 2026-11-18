// Limitador de intentos en memoria (ventana deslizante). Para varias instancias del servidor usar Redis/proxy.
const mapa = new Map();
function golpe(clave, max, ventanaMs) {
  const ahora = Date.now(), arr = (mapa.get(clave) || []).filter(t => ahora - t < ventanaMs);
  arr.push(ahora); mapa.set(clave, arr);
  if (mapa.size > 20000) for (const [k, v] of mapa) if (!v.length || ahora - v[v.length - 1] > ventanaMs) mapa.delete(k);
  return arr.length <= max;
}
const reiniciar = clave => mapa.delete(clave);
module.exports = { golpe, reiniciar };

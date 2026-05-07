/**
 * Conversor de números enteros a palabras en español (guaraníes).
 * Extraído de pre-sale-pdf para mantenibilidad y reuso.
 */
export const numberToWordsGs = (n: number): string => {
  if (n === 0) return "CERO";
  const u = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
  const e = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
  const d = ["", "", "VEINTI", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
  const c = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];
  const sub1000 = (x: number): string => {
    if (x === 0) return "";
    if (x === 100) return "CIEN";
    const cen = Math.floor(x / 100);
    const r = x % 100;
    let s = cen ? c[cen] : "";
    if (r) {
      if (s) s += " ";
      if (r < 10) s += u[r];
      else if (r < 20) s += e[r - 10];
      else {
        const dd = Math.floor(r / 10);
        const uu = r % 10;
        if (dd === 2) s += uu ? `VEINTI${u[uu].toLowerCase()}`.toUpperCase() : "VEINTE";
        else s += uu ? `${d[dd]} Y ${u[uu]}` : d[dd];
      }
    }
    return s;
  };
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  let out = "";
  if (millones) out += millones === 1 ? "UN MILLÓN" : `${sub1000(millones)} MILLONES`;
  if (miles) out += `${out ? " " : ""}${miles === 1 ? "MIL" : `${sub1000(miles)} MIL`}`;
  if (resto) out += `${out ? " " : ""}${sub1000(resto)}`;
  return out.trim();
};

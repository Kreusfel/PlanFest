// QR code en SVG, à partir de qrcode-generator vendorisé (aucun réseau).
import qrcode from "../../vendor/qrcode.js";

export function qrSVG(text, cellSize = 3, margin = 2) {
  const qr = qrcode(0, "M"); // type auto, correction moyenne
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize, margin, scalable: true });
}

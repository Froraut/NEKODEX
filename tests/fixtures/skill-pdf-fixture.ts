/** Small ordinary text-layer PDF fixture; no parser, image, font download or external process. */
export function createTextPdf(pages: readonly (readonly string[])[]): Buffer {
  if (!pages.length || pages.length > 40 || pages.some(lines => lines.some(line => /[^\x20-\x7e]/.test(line)))) throw new Error("Fixture requires bounded ASCII pages");
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  for (const [index, lines] of pages.entries()) {
    const stream = "BT\n/F1 12 Tf\n72 720 Td\n14 TL\n" + lines.map(line => `(${line.replace(/([\\()])/g, "\\$1")}) Tj\nT*\n`).join("") + "ET\n";
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  let text = "%PDF-1.7\n", offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(text, "ascii");
}

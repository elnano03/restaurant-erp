import { mkdir, copyFile, readdir } from "node:fs/promises";
const target = "public/invoice-reader";
await mkdir(target + "/core", { recursive: true });
await copyFile(
  "node_modules/tesseract.js/dist/worker.min.js",
  target + "/worker.min.js",
);
await copyFile(
  "node_modules/tesseract.js/LICENSE.md",
  target + "/TESSERACT-LICENSE",
);
await copyFile(
  "node_modules/tesseract.js-core/LICENSE",
  target + "/CORE-LICENSE",
);
for (const file of await readdir("node_modules/tesseract.js-core"))
  if (file.endsWith(".wasm.js"))
    await copyFile(
      "node_modules/tesseract.js-core/" + file,
      target + "/core/" + file,
    );
for (const lang of ["eng", "spa"])
  await copyFile(
    `node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`,
    `${target}/${lang}.traineddata.gz`,
  );
await copyFile(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  target + "/pdf.worker.min.mjs",
);
await copyFile("node_modules/pdfjs-dist/LICENSE", target + "/PDFJS-LICENSE");

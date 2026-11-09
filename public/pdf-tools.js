(() => {
  const PDF_LIB_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
  const PDF_LIB_SRI = "sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI";
  const PAGE_WIDTH = 595;
  const IMAGE_MAX_SIDE = 2200;
  const IMAGE_QUALITY = 0.8;
  const PDF_IMAGE_MAX_SIDE = 1800;
  const PDF_IMAGE_QUALITY = 0.72;
  const MIN_IMAGE_BYTES = 40 * 1024;
  const MIN_GAIN = 0.1;

  let libPromise;
  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    libPromise ||= new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PDF_LIB_URL;
      s.integrity = PDF_LIB_SRI;
      s.crossOrigin = "anonymous";
      s.onload = () => resolve(window.PDFLib);
      s.onerror = () => { libPromise = null; reject(new Error("Impossible de charger l'outil PDF")); };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

  async function toJpeg(source, width, height, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error("Conversion d'image impossible");
    return new Uint8Array(await blob.arrayBuffer());
  }

  function fit(w, h, max) {
    const s = Math.min(1, max / Math.max(w, h));
    return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
  }

  const isImage = (f) => /^image\/(png|jpe?g|heic|heif)$/i.test(f.type) || /\.(png|jpe?g|heic|heif)$/i.test(f.name);
  const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

  async function imagesToPdf(files, onStep = () => {}) {
    const { PDFDocument } = await loadPdfLib();
    const doc = await PDFDocument.create();
    for (const [i, f] of files.entries()) {
      onStep(i + 1, files.length);
      let bitmap;
      try {
        bitmap = await createImageBitmap(f, { imageOrientation: "from-image" });
      } catch {
        throw new Error(`« ${f.name} » n'est pas une image lisible`);
      }
      const [w, h] = fit(bitmap.width, bitmap.height, IMAGE_MAX_SIDE);
      const jpg = await toJpeg(bitmap, w, h, IMAGE_QUALITY);
      bitmap.close?.();
      const img = await doc.embedJpg(jpg);
      const pageH = (PAGE_WIDTH * h) / w;
      doc.addPage([PAGE_WIDTH, pageH]).drawImage(img, { x: 0, y: 0, width: PAGE_WIDTH, height: pageH });
      await yieldToUi();
    }
    const bytes = await doc.save({ useObjectStreams: true });
    const base = files[0].name.replace(/\.[^.]+$/, "") || "photos";
    return new File([bytes], `${base}.pdf`, { type: "application/pdf" });
  }

  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function compressPdf(file, onStep = () => {}) {
    const keep = (reason) => ({ file, compressed: false, reason });
    const L = await loadPdfLib();
    const { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFRef } = L;
    const N = (s) => PDFName.of(s);
    const original = new Uint8Array(await file.arrayBuffer());

    let doc;
    try {
      doc = await PDFDocument.load(original, { updateMetadata: false });
    } catch {
      return keep("PDF protégé ou illisible, envoyé tel quel");
    }

    const all = doc.context.enumerateIndirectObjects();
    const masks = new Set();
    for (const [, obj] of all) {
      if (!(obj instanceof PDFRawStream)) continue;
      for (const k of ["SMask", "Mask"]) {
        const m = obj.dict.get(N(k));
        if (m instanceof PDFRef) masks.add(m.toString());
      }
    }

    const colorComponents = (cs) => {
      if (cs === N("DeviceRGB")) return 3;
      if (cs === N("DeviceGray")) return 1;
      if (cs instanceof PDFArray && cs.get(0) === N("ICCBased")) {
        const icc = doc.context.lookup(cs.get(1));
        const n = icc?.dict?.get(N("N"))?.asNumber?.();
        return n === 1 || n === 3 ? n : 0;
      }
      return 0;
    };

    const images = all.filter(([ref, obj]) =>
      obj instanceof PDFRawStream &&
      obj.dict.get(N("Subtype")) === N("Image") &&
      !masks.has(ref.toString()) &&
      obj.contents.length >= MIN_IMAGE_BYTES);

    const canInflate = typeof DecompressionStream === "function";
    for (const [i, [ref, obj]] of images.entries()) {
      onStep(i + 1, images.length);
      await yieldToUi();
      try {
        const d = obj.dict;
        if (d.has(N("Decode")) || d.has(N("ImageMask"))) continue;
        const f = d.get(N("Filter"));
        const filters = f instanceof PDFArray ? f.asArray() : f ? [f] : [];
        if (filters.length !== 1) continue;
        const w = d.get(N("Width"))?.asNumber?.();
        const h = d.get(N("Height"))?.asNumber?.();
        const comps = colorComponents(d.get(N("ColorSpace")));
        if (!w || !h || !comps) continue;

        let bitmap;
        if (filters[0] === N("DCTDecode")) {
          bitmap = await createImageBitmap(new Blob([obj.contents], { type: "image/jpeg" }));
        } else if (filters[0] === N("FlateDecode") && canInflate) {
          if (d.get(N("BitsPerComponent"))?.asNumber?.() !== 8 || d.has(N("DecodeParms"))) continue;
          const raw = await inflate(obj.contents);
          if (raw.length < w * h * comps) continue;
          const rgba = new Uint8ClampedArray(w * h * 4);
          for (let p = 0, q = 0; p < w * h; p++, q += comps) {
            const r = raw[q];
            rgba[p * 4] = r;
            rgba[p * 4 + 1] = comps === 3 ? raw[q + 1] : r;
            rgba[p * 4 + 2] = comps === 3 ? raw[q + 2] : r;
            rgba[p * 4 + 3] = 255;
          }
          bitmap = await createImageBitmap(new ImageData(rgba, w, h));
        } else {
          continue;
        }

        const [nw, nh] = fit(w, h, PDF_IMAGE_MAX_SIDE);
        const jpg = await toJpeg(bitmap, nw, nh, PDF_IMAGE_QUALITY);
        bitmap.close?.();
        if (jpg.length >= obj.contents.length * (1 - MIN_GAIN)) continue;

        const nd = d.clone(doc.context);
        nd.set(N("Width"), doc.context.obj(nw));
        nd.set(N("Height"), doc.context.obj(nh));
        nd.set(N("Filter"), N("DCTDecode"));
        nd.set(N("ColorSpace"), N("DeviceRGB"));
        nd.set(N("BitsPerComponent"), doc.context.obj(8));
        nd.delete(N("DecodeParms"));
        nd.delete(N("Length"));
        doc.context.assign(ref, PDFRawStream.of(nd, jpg));
      } catch {
        // An image that can't be decoded is left untouched.
      }
    }

    const out = await doc.save({ useObjectStreams: true });
    if (out.length >= original.length * (1 - MIN_GAIN)) return keep("déjà compressé");
    return {
      file: new File([out], file.name, { type: "application/pdf" }),
      compressed: true,
      before: original.length,
      after: out.length,
    };
  }

  window.PdfTools = { isImage, isPdf, imagesToPdf, compressPdf };
})();

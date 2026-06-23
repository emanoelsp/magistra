// Client-side utility: parse DOCX anchor drawings and apply correct absolute
// positions in the DOM after docx-preview renders.
//
// Strategy:
//   • Y position: read from the wrapper div's getBoundingClientRect().top —
//     docx-preview already placed the wrapper in the correct paragraph flow
//     position, so we trust its vertical placement and just use it.
//   • X position: override with the positionH value from the DOCX XML, because
//     docx-preview either collapses it (wrapNone / width:0 containing block) or
//     stacks everything float:left regardless of the actual offset.
//
// After matching each anchor image, we move the <img> to be a direct child of
// the <section> (page element) and apply position:absolute with the computed
// left and top values.

const EMU_PER_MM = 36000;
const LOG = "[docx-anchor-fix]";

interface AnchorData {
  imgBase64Short: string;
  posX_mm: number;
  posY_mm: number;   // kept for logging; Y comes from wrapper's natural position
  width_mm: number;
  height_mm: number;
  relFromH: string;
  sourceFile: string;
  imagePath: string;
}

async function buildRelMap(
  zip: import("jszip"),
  relsPath: string,
): Promise<Record<string, string>> {
  const file = zip.files[relsPath];
  if (!file) return {};
  const xml = await file.async("string");
  const dir = relsPath.replace("/_rels/", "/").replace(/\.rels$/, "").replace(/[^/]+$/, "");
  const map: Record<string, string> = {};
  for (const m of xml.matchAll(/Id="([^"]+)"[^>]+Target="([^"]+)"/g)) {
    const [, rId, target] = m;
    map[rId] = target.startsWith("/") ? target.slice(1) : (dir + target).replace(/[^/]+\/\.\.\//g, "");
  }
  return map;
}

async function parseAnchorsFromXml(
  zip: import("jszip"),
  xmlPath: string,
  relMap: Record<string, string>,
  sourceFile: string,
): Promise<AnchorData[]> {
  const file = zip.files[xmlPath];
  if (!file) return [];
  const xml = await file.async("string");
  const results: AnchorData[] = [];

  const anchorMatches = [...xml.matchAll(/<wp:anchor[\s\S]*?<\/wp:anchor>/g)];
  console.debug(LOG, `${xmlPath}: ${anchorMatches.length} wp:anchor(s)`);

  for (const m of anchorMatches) {
    const ax = m[0];
    const posH = ax.match(/<wp:positionH\s+relativeFrom="([^"]*)"[^>]*>[\s\S]*?<wp:posOffset>([-\d]+)<\/wp:posOffset>/);
    const posV = ax.match(/<wp:positionV[^>]*>[\s\S]*?<wp:posOffset>([-\d]+)<\/wp:posOffset>/);
    const extent = ax.match(/<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"/);
    const embed = ax.match(/r:embed="([^"]*)"/);

    if (!extent || !embed) continue;

    const imagePath = relMap[embed[1]];
    if (!imagePath || !zip.files[imagePath]) {
      console.warn(LOG, `rId=${embed[1]} → image not found`);
      continue;
    }

    const imgBytes = await zip.files[imagePath].async("uint8array");
    let base64 = "";
    for (let i = 0; i < imgBytes.length; i += 8192) {
      base64 += btoa(String.fromCharCode(...imgBytes.subarray(i, i + 8192)));
    }

    const posX_mm = posH ? parseInt(posH[2]) / EMU_PER_MM : 0;
    const posY_mm = posV ? parseInt(posV[1]) / EMU_PER_MM : 0;

    console.debug(LOG, `anchor: ${imagePath}`, {
      relFromH: posH?.[1],
      posX_mm: posX_mm.toFixed(1),
      posY_mm: posY_mm.toFixed(1),
      w: (parseInt(extent[1]) / EMU_PER_MM).toFixed(1),
      h: (parseInt(extent[2]) / EMU_PER_MM).toFixed(1),
    });

    results.push({
      imgBase64Short: base64.slice(0, 64),
      posX_mm,
      posY_mm,
      width_mm: parseInt(extent[1]) / EMU_PER_MM,
      height_mm: parseInt(extent[2]) / EMU_PER_MM,
      relFromH: posH?.[1] ?? "column",
      sourceFile,
      imagePath,
    });
  }

  return results;
}

export async function fixDocxAnchorImages(
  buffer: ArrayBuffer,
  container: HTMLElement,
): Promise<void> {
  console.group(LOG);
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);

    const anchors: AnchorData[] = [];
    for (const zipPath of Object.keys(zip.files).sort()) {
      if (!/^word\/(header\d*|document)\.xml$/.test(zipPath)) continue;
      const relsPath = zipPath.replace(/^(word\/)([^/]+)$/, "word/_rels/$2.rels");
      const relMap = await buildRelMap(zip, relsPath);
      const isHeader = zipPath.includes("header");
      anchors.push(
        ...(await parseAnchorsFromXml(zip, zipPath, relMap, isHeader ? "header" : "document")),
      );
    }

    if (anchors.length === 0) {
      console.info(LOG, "no anchors found");
      return;
    }
    console.info(LOG, `${anchors.length} anchor(s) parsed`);

    const imgs = Array.from(container.querySelectorAll("img")) as HTMLImageElement[];
    console.debug(LOG, `${imgs.length} img(s) in container`);

    interface HeaderConstraint {
      headerEl: HTMLElement;
      columnLeft_mm: number;
      anchors: Array<{ leftMm: number; widthMm: number }>;
    }
    const headerConstraints = new Map<HTMLElement, HeaderConstraint>();

    for (const anchor of anchors) {
      // Match by base64 prefix
      const img = imgs.find((el) => {
        if (!el.src.startsWith("data:")) return false;
        return (el.src.split(",")[1] ?? "").startsWith(anchor.imgBase64Short);
      });
      if (!img) {
        console.warn(LOG, `no img match for ${anchor.imagePath}`);
        continue;
      }

      // Walk up within container to find wrapper, header, section
      let wrapper: HTMLElement | null = null;
      let headerEl: HTMLElement | null = null;
      let sectionEl: HTMLElement | null = null;
      let el: HTMLElement | null = img.parentElement;
      while (el && el !== container) {
        if (
          !wrapper &&
          (el.style.width === "0px" ||
            el.style.float === "left" ||
            el.style.float === "right")
        ) {
          wrapper = el;
        }
        if (!headerEl && el.tagName === "HEADER") headerEl = el;
        if (!sectionEl && el.tagName === "SECTION") sectionEl = el;
        el = el.parentElement;
      }

      if (!sectionEl) {
        console.warn(LOG, `no section found for ${anchor.imagePath}`);
        continue;
      }

      // ── Table-cell check ─────────────────────────────────────────────────────
      // If the anchor image lives inside a <td> (e.g. a header logo table), DO NOT
      // move it to the section. Moving it breaks the table layout: the SC logo text
      // separates from the flag image, and the CEDUP logo disappears off-screen.
      // Instead: unwrap the zero-size/float wrapper and let the image render inline
      // inside its cell at the correct dimensions.
      const tdAncestor = (() => {
        let e: HTMLElement | null = img.parentElement;
        while (e && e !== container) {
          if (e.tagName === "TD") return e as HTMLElement;
          e = e.parentElement;
        }
        return null;
      })();

      if (tdAncestor) {
        if (wrapper) {
          wrapper.style.float = "none";
          wrapper.style.width = "auto";
          wrapper.style.height = "auto";
          wrapper.style.display = "block";
          wrapper.style.overflow = "visible";
          wrapper.style.position = "static";
        }
        img.style.width = `${anchor.width_mm}mm`;
        // height: auto lets the browser scale proportionally when maxWidth:100%
        // kicks in — avoids distortion when the cell is narrower than the image.
        img.style.height = "auto";
        img.style.maxWidth = "100%";
        img.style.display = "block";
        img.style.position = "static";

        // posX > 80 mm from column start → image belongs on the right side of the page.
        // Move it to the last <td> in the row and right-align it.
        // posX < 15 mm → left-aligned in its cell (e.g. a flag/logo on the left).
        const LEFT_THRESHOLD_MM = 15;
        const RIGHT_THRESHOLD_MM = 80;
        if (anchor.posX_mm > RIGHT_THRESHOLD_MM) {
          const rowEl = (() => {
            let e: HTMLElement | null = tdAncestor.parentElement;
            while (e && e !== container && e.tagName !== "TR") e = e.parentElement;
            return e?.tagName === "TR" ? e : null;
          })();
          const tds = rowEl ? Array.from(rowEl.querySelectorAll<HTMLElement>(":scope > td, :scope > th")) : [];
          const targetTd = tds.length > 1 ? tds[tds.length - 1] : tdAncestor;
          if (targetTd !== img.parentElement) targetTd.appendChild(img);
          img.style.margin = "0 0 0 auto"; // push to right edge of cell
          console.info(LOG, `inline-fixed (td→right) ${anchor.imagePath}`, {
            w: `${anchor.width_mm.toFixed(1)}mm`, posX: `${anchor.posX_mm.toFixed(1)}mm`,
          });
        } else if (anchor.posX_mm < LEFT_THRESHOLD_MM) {
          img.style.margin = "0";
          tdAncestor.style.paddingLeft = "0"; // flush to cell edge — remove default td padding
          console.info(LOG, `inline-fixed (td→left) ${anchor.imagePath}`, {
            w: `${anchor.width_mm.toFixed(1)}mm`, posX: `${anchor.posX_mm.toFixed(1)}mm`,
          });
        } else {
          img.style.margin = "0 auto";
          console.info(LOG, `inline-fixed (td) ${anchor.imagePath}`, {
            w: `${anchor.width_mm.toFixed(1)}mm`,
          });
        }
        continue;
      }

      // ── Free-floating anchor: absolute positioning relative to section ────────

      // Y: trust docx-preview's natural vertical placement.
      const ref = wrapper ?? img;
      const refRect = ref.getBoundingClientRect();
      const sectionRect = sectionEl.getBoundingClientRect();
      const topMm = (refRect.top - sectionRect.top) / 3.7795;

      // X: use section's computed padding-left as column origin.
      const sectionCS = getComputedStyle(sectionEl);
      const sectionPL_px = parseFloat(sectionCS.paddingLeft || "0");
      const columnLeft_mm = sectionPL_px / 3.7795;

      let leftMm: number;
      if (anchor.relFromH === "column") {
        leftMm = columnLeft_mm + anchor.posX_mm;
      } else if (anchor.relFromH === "margin") {
        leftMm = anchor.posX_mm;
      } else {
        leftMm = anchor.posX_mm;
      }

      console.info(LOG, `absolute-fixed ${anchor.imagePath}`, {
        relFromH: anchor.relFromH,
        left: `${leftMm.toFixed(1)}mm`,
        top: `${topMm.toFixed(1)}mm`,
        w: `${anchor.width_mm.toFixed(1)}mm`,
        h: `${anchor.height_mm.toFixed(1)}mm`,
      });

      if (getComputedStyle(sectionEl).position === "static") {
        sectionEl.style.position = "relative";
      }
      sectionEl.style.overflow = "visible";

      sectionEl.appendChild(img);

      img.style.position = "absolute";
      img.style.left = `${leftMm}mm`;
      img.style.top = `${topMm}mm`;
      img.style.width = `${anchor.width_mm}mm`;
      img.style.height = `${anchor.height_mm}mm`;
      img.style.maxWidth = "none";
      img.style.zIndex = "1";

      if (wrapper) {
        wrapper.style.display = "none";
      }

      // Track for text-raising pass (only free-floating anchors need it).
      const constraintEl: HTMLElement | null = (() => {
        if (headerEl) return headerEl;
        let e: HTMLElement | null = (wrapper ?? img).parentElement;
        while (e && e !== sectionEl) {
          if (e.tagName === "TABLE" || e.tagName === "TR" || e.tagName === "P") return e;
          e = e.parentElement;
        }
        return null;
      })();

      if (constraintEl) {
        if (!headerConstraints.has(sectionEl)) {
          headerConstraints.set(sectionEl, { headerEl: constraintEl, columnLeft_mm, anchors: [] });
        }
        headerConstraints.get(sectionEl)!.anchors.push({ leftMm, widthMm: anchor.width_mm });
      }
    }

    // ── Raise text containers above anchor images ─────────────────────────────
    // For <header> elements: apply asymmetric padding + overflow:hidden to confine
    // text between logos. Left and right padding are computed independently so a
    // logo only on the left does not also steal space on the right.
    // For body-level elements (TABLE / TR / P): only set z-index — do NOT apply
    // overflow:hidden or padding (breaks td { position: relative } clipping).
    for (const [secEl, { headerEl: hEl, columnLeft_mm: colLeft, anchors: hAnchors }] of headerConstraints.entries()) {
      if (hAnchors.length === 0) continue;
      const isHeaderEl = hEl.tagName === "HEADER";

      // Raise above absolutely-positioned images (z-index:1).
      hEl.style.position = "relative";
      hEl.style.zIndex = "2";

      if (isHeaderEl) {
        // Column right edge from the section's right padding.
        const secRect = secEl.getBoundingClientRect();
        const secPR_mm = parseFloat(getComputedStyle(secEl).paddingRight || "0") / 3.7795;
        const colRight_mm = secRect.width / 3.7795 - secPR_mm;
        const centerMm = (colLeft + colRight_mm) / 2;
        const GAP_MM = 2; // min gap between logo edge and text

        // Separate left/right padding — previous symmetric formula applied the
        // left logo's width as right padding too, shrinking text unnecessarily.
        let leftPad_mm = 0;
        let rightPad_mm = 0;
        for (const a of hAnchors) {
          if (a.leftMm <= centerMm) {
            leftPad_mm = Math.max(leftPad_mm, (a.leftMm - colLeft) + a.widthMm + GAP_MM);
          } else {
            rightPad_mm = Math.max(rightPad_mm, colRight_mm - a.leftMm + GAP_MM);
          }
        }

        hEl.style.paddingLeft  = `${leftPad_mm}mm`;
        hEl.style.paddingRight = `${rightPad_mm}mm`;
        hEl.style.boxSizing    = "border-box";
        hEl.style.overflow     = "hidden";

        // ── Collision guard: scale down any image still overlapping text ──────
        // getBoundingClientRect() forces a synchronous reflow so rects reflect the
        // padding already applied above.
        const anchorImgs = Array.from(
          secEl.querySelectorAll<HTMLImageElement>("img"),
        ).filter((img) => img.style.position === "absolute");
        const textEls = Array.from(
          hEl.querySelectorAll<HTMLElement>("p, td, th"),
        ).filter((el) => (el.textContent ?? "").trim().length > 1);

        for (const img of anchorImgs) {
          for (let attempt = 0; attempt < 3; attempt++) {
            const ir = img.getBoundingClientRect();
            const overlaps = textEls.some((t) => {
              const tr = t.getBoundingClientRect();
              return (
                tr.width > 3 && tr.height > 3 &&
                !(tr.right <= ir.left + 2 || tr.left >= ir.right - 2 ||
                  tr.bottom <= ir.top + 2 || tr.top >= ir.bottom - 2)
              );
            });
            if (!overlaps) break;
            const curW = parseFloat(img.style.width);
            if (isNaN(curW) || curW <= 5) break;
            img.style.width  = `${(curW * 0.82).toFixed(1)}mm`;
            img.style.height = "auto";
            console.info(LOG, `collision guard: scaled to ${(curW * 0.82).toFixed(1)}mm (attempt ${attempt + 1})`);
          }
        }

        console.info(LOG, "header padding applied", {
          leftPad_mm: leftPad_mm.toFixed(1),
          rightPad_mm: rightPad_mm.toFixed(1),
        });
      }

      // Reset letter-spacing on every paragraph so long lines fit
      const paras = Array.from(hEl.querySelectorAll("p")) as HTMLParagraphElement[];
      for (const p of paras) {
        p.style.letterSpacing = "normal";
        p.style.wordSpacing = "normal";
      }

      console.info(LOG, "text raised above anchors", {
        isHeaderEl,
        paragraphs: paras.length,
        tag: hEl.tagName,
      });
    }

    console.info(LOG, "done");
  } catch (err) {
    console.error(LOG, err);
  } finally {
    console.groupEnd();
  }
}

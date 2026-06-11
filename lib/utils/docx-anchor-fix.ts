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

      // ── Y: trust docx-preview's natural vertical placement ──────────────────
      // The wrapper div lives in the paragraph flow at the correct vertical
      // position, so use its getBoundingClientRect top relative to the section.
      const ref = wrapper ?? img;
      const refRect = ref.getBoundingClientRect();
      const sectionRect = sectionEl.getBoundingClientRect();
      const topMm = (refRect.top - sectionRect.top) / 3.7795;

      // ── X: use section's computed padding-left as column origin ──────────────
      // getComputedStyle gives the section's actual padding-left in CSS px.
      // Converting to mm gives the distance from the section's padding-edge
      // (= position:absolute origin) to the column left edge.
      // For column-relative anchors: left = columnLeft_mm + posX_mm.
      const sectionCS = getComputedStyle(sectionEl);
      const sectionPL_px = parseFloat(sectionCS.paddingLeft || "0");
      const columnLeft_mm = sectionPL_px / 3.7795;

      // Log rects for debugging
      const headerRect = headerEl?.getBoundingClientRect();
      console.debug(LOG, `rects for ${anchor.imagePath}`, {
        sectionLeft: sectionRect.left.toFixed(0),
        headerLeft: headerRect ? headerRect.left.toFixed(0) : "n/a",
        wrapperLeft: refRect.left.toFixed(0),
        sectionPaddingLeft_px: sectionPL_px.toFixed(1),
        columnLeft_mm: columnLeft_mm.toFixed(1),
        "headerLeft - sectionLeft (px)": headerRect ? (headerRect.left - sectionRect.left).toFixed(1) : "n/a",
      });

      let leftMm: number;
      if (anchor.relFromH === "column") {
        leftMm = columnLeft_mm + anchor.posX_mm;
      } else if (anchor.relFromH === "margin") {
        leftMm = anchor.posX_mm;
      } else {
        // "page" or unknown: posX is from page/section left edge
        leftMm = anchor.posX_mm;
      }

      console.info(LOG, `fixing ${anchor.imagePath}`, {
        relFromH: anchor.relFromH,
        columnLeft_mm: columnLeft_mm.toFixed(1),
        posX_mm: anchor.posX_mm.toFixed(1),
        left: `${leftMm.toFixed(1)}mm`,
        top: `${topMm.toFixed(1)}mm`,
        w: `${anchor.width_mm.toFixed(1)}mm`,
        h: `${anchor.height_mm.toFixed(1)}mm`,
      });

      // Make section a positioning context
      if (getComputedStyle(sectionEl).position === "static") {
        sectionEl.style.position = "relative";
      }
      sectionEl.style.overflow = "visible";

      // Move img to section and apply absolute position
      sectionEl.appendChild(img);

      img.style.position = "absolute";
      img.style.left = `${leftMm}mm`;
      img.style.top = `${topMm}mm`;
      img.style.width = `${anchor.width_mm}mm`;
      img.style.height = `${anchor.height_mm}mm`;
      img.style.maxWidth = "none";
      img.style.zIndex = "1";

      // Hide empty drawing wrapper to eliminate ghost float/block space
      if (wrapper) {
        wrapper.style.display = "none";
      }

      // Track anchors for the text-constraint pass below.
      // Prefer a <header> ancestor if found; for body-level anchors (where the
      // anchor is in word/document.xml body instead of a header XML file) fall
      // back to the nearest <table>, <tr>, or <p> ancestor inside the section.
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
    // For <header> elements (from DOCX header XML files): apply full constraint
    // with padding + overflow:hidden to confine text between the two flag images.
    // For body-level elements (TABLE / TR / P): only set z-index so text renders
    // on top of z-index:1 images — do NOT apply overflow:hidden or padding because
    // those interact badly with `td { position: relative }` in the editor, which
    // makes table cells positioning contexts and causes clipping of absolute images.
    for (const { headerEl: hEl, columnLeft_mm: colLeft, anchors: hAnchors } of headerConstraints.values()) {
      if (hAnchors.length === 0) continue;
      const sorted = [...hAnchors].sort((a, b) => a.leftMm - b.leftMm);
      const padding_mm = Math.max(0, (sorted[0].leftMm - colLeft) + sorted[0].widthMm);
      const isHeaderEl = hEl.tagName === "HEADER";

      // Raise above absolutely-positioned images (z-index:1).
      hEl.style.position = "relative";
      hEl.style.zIndex = "2";

      if (isHeaderEl) {
        // Full constraint only for true <header> elements — safe to clip.
        const snug_mm = Math.max(0, Math.min(padding_mm, 20));
        hEl.style.paddingLeft = `${snug_mm}mm`;
        hEl.style.paddingRight = `${snug_mm}mm`;
        hEl.style.boxSizing = "border-box";
        hEl.style.overflow = "hidden";
      }

      // Reset letter-spacing on every paragraph so long lines fit
      const paras = Array.from(hEl.querySelectorAll("p")) as HTMLParagraphElement[];
      for (const p of paras) {
        p.style.letterSpacing = "normal";
        p.style.wordSpacing = "normal";
      }

      console.info(LOG, "text raised above anchors", {
        colLeft_mm: colLeft.toFixed(1),
        padding_mm: padding_mm.toFixed(1),
        fullConstraint: isHeaderEl,
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

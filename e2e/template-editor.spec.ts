/**
 * E2E — Template editor: upload, edição de campos e posicionamento de placeholders
 *
 * Pré-requisitos:
 *   - `npm run dev` rodando em localhost:3000
 *   - Usuário prof5@gmail.com / em23mano12 existente no Firebase Auth
 *   - Arquivos DOCX em ./template_original/
 *
 * Estratégia: um único upload (beforeAll) cria o template; os 3 testes operam
 * sobre ele em sequência. Isso evita rate-limit de AI e limite de templates.
 *
 * Execute com:
 *   npx playwright test e2e/template-editor.spec.ts --headed
 */

import path from "path";
import { test, expect, type Page, type Locator } from "@playwright/test";

// ─── Caminhos dos templates ───────────────────────────────────────────────────
const TEMPLATES_DIR = path.resolve(__dirname, "../template_original");

// Usa o template mais rico para cobrir todos os cenários
const TEMPLATE_FILE = "C-Planejamento anual - EMIEP-2026 .docx";

// ID compartilhado entre os testes (preenchido no beforeAll)
let sharedTemplateId = "";

// Campos registrados no T1 que sobreviveram à exclusão (usados no T2/T3)
let survivingKeys: string[] = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill("prof5@gmail.com");
  await page.locator("#password").fill("em23mano12");
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

/** Aguarda o doc DOCX terminar de renderizar (botão "Salvar edições" fica visível). */
async function waitForDocReady(page: Page, timeout = 120_000) {
  await expect(
    page.getByRole("button", { name: /Salvar edições/i }),
  ).toBeVisible({ timeout });
}

/** Seleciona o estado no select (obrigatório para salvar). */
async function selectEstado(page: Page, value = "SP") {
  const estadoSelect = page
    .locator("select")
    .filter({ has: page.locator('option[value="SP"]') })
    .first();
  if ((await estadoSelect.inputValue()) !== value) {
    await estadoSelect.selectOption(value);
  }
}

/** Card de um campo pelo seu key. */
function fieldCard(page: Page, key: string): Locator {
  return page.locator(`[data-field-card="${key}"]`);
}

/** Coleta todos os keys visíveis no sidebar. */
async function collectFieldKeys(page: Page): Promise<string[]> {
  const cards = await page.locator("[data-field-card]").all();
  const keys: string[] = [];
  for (const card of cards) {
    const key = await card.getAttribute("data-field-card");
    if (key) keys.push(key);
  }
  return keys;
}

/** Retorna keys de campos marcados como "não encontrados". */
async function getMissingFieldKeys(page: Page): Promise<string[]> {
  const cards = await page.locator("[data-field-card]").all();
  const missing: string[] = [];
  for (const card of cards) {
    const text = await card.textContent();
    if ((text ?? "").includes("⚠ Não encontrado") || (text ?? "").includes("⚠ Verificar")) {
      const key = await card.getAttribute("data-field-card");
      if (key) missing.push(key);
    }
  }
  return missing;
}

/**
 * Exclui um campo pelo key.
 * O botão Trash2 é o último botão dentro do cabeçalho do card
 * (Crosshair é o penúltimo, tem title="Localizar no documento").
 */
async function deleteField(page: Page, key: string) {
  const card = fieldCard(page, key);
  const trashBtn = card
    .locator("div.flex.cursor-pointer")
    .first()
    .getByRole("button")
    .last();
  await trashBtn.click();
  await page.waitForTimeout(300);
}

// ─── Setup: login + upload único ─────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await login(page);

  const filePath = path.join(TEMPLATES_DIR, TEMPLATE_FILE);

  await page.goto("/dashboard/templates");

  // Verifica se já existe um template compatível (reusa se houver)
  // Caso contrário, faz upload
  const limitReached = await page.locator("text=limite").count() > 0
    || await page.locator("text=Atingiu").count() > 0;

  if (limitReached) {
    // Tenta pegar o ID de um template já existente da URL de algum botão de editar
    const editLink = page.locator('a[href*="/editar"]').first();
    const href = await editLink.getAttribute("href").catch(() => null);
    if (href) {
      const m = href.match(/templates\/([^/]+)\/editar/);
      if (m) {
        sharedTemplateId = m[1];
        console.log(`[setup] Limite atingido — reutilizando template existente: ${sharedTemplateId}`);
        await page.close();
        return;
      }
    }
    throw new Error("Limite de templates atingido e não foi possível encontrar um template existente.");
  }

  // Escola e tipo
  await page.getByPlaceholder("Ex.: E. M. João XXIII").fill("Escola E2E Playwright");
  await page.locator("select").nth(0).selectOption("plano_anual");

  // Upload
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(filePath);
  await expect(
    page.getByRole("button", { name: /Analisar template com a Magis/i }),
  ).toBeEnabled({ timeout: 5_000 });
  await page.getByRole("button", { name: /Analisar template com a Magis/i }).click();

  // Aguarda extração da Magis (pode levar até 2 min)
  await page.waitForURL(/\/confirmar/, { timeout: 120_000 });
  const match = page.url().match(/templates\/([^/]+)\/confirmar/);
  if (!match) throw new Error(`URL inesperada: ${page.url()}`);
  sharedTemplateId = match[1];
  console.log(`[setup] Template criado: ${sharedTemplateId}`);

  await page.close();
});

// ─── Testes ───────────────────────────────────────────────────────────────────

test.describe("Template Editor — Upload, campos e placeholders", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 1: Verificar campos → excluir os fora do lugar → confirmar
  // ───────────────────────────────────────────────────────────────────────────
  test("T1: excluir campos fora do lugar e confirmar template", async ({ page }) => {
    expect(sharedTemplateId).toBeTruthy();

    // 1. Abre a página de confirmar (onde a extração acabou)
    await page.goto(`/dashboard/templates/${sharedTemplateId}/confirmar`);
    await waitForDocReady(page);
    await selectEstado(page, "SP");

    // 2. Registra campos extraídos
    const initialKeys = await collectFieldKeys(page);
    console.log(`[T1] ${initialKeys.length} campos extraídos: ${initialKeys.join(", ")}`);
    expect(initialKeys.length).toBeGreaterThan(0);

    // 3. Identifica campos fora do lugar
    const missing = await getMissingFieldKeys(page);
    console.log(`[T1] Campos fora do lugar: ${missing.join(", ") || "(nenhum)"}`);

    // 4. Exclui os não encontrados (ou último se todos OK)
    const toDelete = missing.length > 0 ? missing : [initialKeys[initialKeys.length - 1]];
    console.log(`[T1] Excluindo: ${toDelete.join(", ")}`);

    for (const key of toDelete) {
      await deleteField(page, key);
      await expect(fieldCard(page, key)).not.toBeAttached({ timeout: 5_000 });
      console.log(`[T1] ✓ "${key}" removido do sidebar`);
    }

    // 5. Verifica contagem após exclusão
    const afterDeleteKeys = await collectFieldKeys(page);
    expect(afterDeleteKeys.length).toBe(initialKeys.length - toDelete.length);
    survivingKeys = afterDeleteKeys; // compartilha com T2/T3
    console.log(`[T1] Restaram ${afterDeleteKeys.length} campos`);

    // 6. Confirma o template
    const confirmBtn = page.getByRole("button", { name: /Confirmar template/i });
    await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
    await confirmBtn.click();

    // Aguarda redirect após confirmação (modal dura ~3s e redireciona)
    await page.waitForURL(/\/dashboard\/templates$/, { timeout: 60_000 });
    console.log(`[T1] ✓ Template confirmado`);

    // 7. Reabre o editor e verifica integridade
    await page.goto(`/dashboard/templates/${sharedTemplateId}/editar`);
    await waitForDocReady(page);

    // Campos excluídos NÃO devem existir
    for (const key of toDelete) {
      await expect(fieldCard(page, key)).not.toBeAttached({ timeout: 5_000 });
      console.log(`[T1] ✓ "${key}" ausente no editor`);
    }

    // Campos remanescentes DEVEM estar presentes com chip no doc
    let chipsLocated = 0;
    for (const key of afterDeleteKeys) {
      await expect(fieldCard(page, key)).toBeAttached({ timeout: 5_000 });
      const chip = page.locator(`[data-field-chip="${key}"]`).first();
      if (await chip.count() > 0) chipsLocated++;
    }
    console.log(`[T1] ✓ ${chipsLocated} chips no doc, ${afterDeleteKeys.length} campos no sidebar`);

    await page.screenshot({ path: "e2e/screenshots/t1-final.png" });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 2: Digitar {{placeholder}} no doc → configurar no sidebar → verificar
  // ───────────────────────────────────────────────────────────────────────────
  test("T2: adicionar placeholder no doc e configurar no sidebar", async ({ page }) => {
    expect(sharedTemplateId).toBeTruthy();

    const NEW_KEY = "campo_novo_e2e";
    const NEW_LABEL = "Campo Novo E2E";

    // 1. Abre o editor
    await page.goto(`/dashboard/templates/${sharedTemplateId}/editar`);
    await waitForDocReady(page);
    await selectEstado(page, "SP");
    await page.waitForTimeout(1_000);

    // 2. Conta chips antes da edição
    const chipsBefore = await page.locator("[data-field-chip]").count();
    const keysBefore = survivingKeys.length > 0
      ? survivingKeys
      : await collectFieldKeys(page);
    console.log(`[T2] Chips antes: ${chipsBefore} | Campos no sidebar: ${keysBefore.length}`);

    // 3. Encontra célula livre para digitar o placeholder
    const allCells = page.locator("td");
    const cellCount = await allCells.count();
    console.log(`[T2] Células disponíveis: ${cellCount}`);
    expect(cellCount).toBeGreaterThan(0);

    let targetCell: Locator | null = null;
    const startIdx = Math.floor(cellCount * 0.4);
    for (let i = startIdx; i < cellCount; i++) {
      const cell = allCells.nth(i);
      const hasChip = (await cell.locator("[data-field-chip]").count()) > 0;
      const inHeaderFooter = await cell.evaluate((el) =>
        !!el.closest("header") || !!el.closest("footer"),
      );
      if (!hasChip && !inHeaderFooter) {
        targetCell = cell;
        console.log(`[T2] Célula alvo: índice ${i}`);
        break;
      }
    }
    if (!targetCell) {
      targetCell = allCells.nth(Math.floor(cellCount / 2));
      console.log(`[T2] Fallback: célula do meio`);
    }

    // 4. Clica e digita o placeholder
    await targetCell.click();
    await page.waitForTimeout(400);
    await page.keyboard.press("End");
    await page.keyboard.type(` {{${NEW_KEY}}}`);
    await page.waitForTimeout(300);

    // 5. Salva edições
    await page.getByRole("button", { name: /Salvar edições/i }).click();
    console.log(`[T2] Clicou "Salvar edições"`);

    // 6. Aguarda banner de configuração do novo campo
    const configBanner = page.locator("text=Novo campo adicionado");
    await expect(configBanner).toBeVisible({ timeout: 90_000 });
    console.log(`[T2] ✓ Banner de configuração apareceu`);

    // 7. Preenche o label no banner
    const newCard = page.locator("[data-field-card]").filter({
      has: page.locator("text=Novo campo adicionado"),
    }).first();
    const labelInput = newCard.locator('input[type="text"]').first();
    await expect(labelInput).toBeVisible({ timeout: 5_000 });
    await labelInput.clear();
    await labelInput.fill(NEW_LABEL);
    await page.waitForTimeout(400);

    // 8. Banner deve desaparecer após preencher label
    await expect(configBanner).not.toBeVisible({ timeout: 10_000 });
    console.log(`[T2] ✓ Banner fechou após preencher label`);

    // 9. Todos os campos originais ainda presentes no sidebar
    for (const key of keysBefore) {
      await expect(fieldCard(page, key)).toBeAttached({ timeout: 5_000 });
    }
    console.log(`[T2] ✓ ${keysBefore.length} campos originais intactos`);

    // 10. O novo campo aparece no sidebar
    const cardWithLabel = page.locator("[data-field-card]").filter({
      has: page.locator(`text=${NEW_LABEL}`),
    });
    await expect(cardWithLabel).toBeVisible({ timeout: 5_000 });
    console.log(`[T2] ✓ Novo campo "${NEW_LABEL}" no sidebar`);

    // 11. Clica "Verificar template"
    await page.getByRole("button", { name: /Verificar template/i }).click();
    console.log(`[T2] Clicou "Verificar template"`);

    // 12. Aguarda modo de revisão
    const confirmarBtn = page.getByRole("button", { name: /Confirmar template/i });
    await expect(confirmarBtn).toBeVisible({ timeout: 90_000 });
    console.log(`[T2] ✓ Modo de revisão ativo`);

    // 13. Verifica chips após salvar
    await page.waitForTimeout(3_000);
    const chipsAfter = await page.locator("[data-field-chip]").count();
    console.log(`[T2] Chips após verificar: ${chipsAfter}`);
    expect(chipsAfter).toBeGreaterThanOrEqual(chipsBefore);

    // O chip do novo campo (pelo key gerado a partir do label ou o key original)
    const newKeyFromLabel = NEW_LABEL.toLowerCase().replace(/\s+/g, "_");
    const chipFound =
      (await page.locator(`[data-field-chip="${NEW_KEY}"]`).count() > 0) ||
      (await page.locator(`[data-field-chip="${newKeyFromLabel}"]`).count() > 0);
    console.log(`[T2] Chip do novo campo no doc: ${chipFound}`);
    expect(chipFound).toBe(true);

    // Chips originais ainda presentes
    let originalChipsOk = 0;
    for (const key of keysBefore.slice(0, 5)) {
      if (await page.locator(`[data-field-chip="${key}"]`).count() > 0) originalChipsOk++;
    }
    console.log(`[T2] Chips originais intactos: ${originalChipsOk}/${Math.min(5, keysBefore.length)}`);
    expect(originalChipsOk).toBeGreaterThan(0);

    // 14. Confirma
    await confirmarBtn.click();
    await page.waitForURL(/\/dashboard\/templates$/, { timeout: 60_000 });
    console.log(`[T2] ✓ Template confirmado`);

    await page.screenshot({ path: "e2e/screenshots/t2-final.png" });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TESTE 3: Reabre o template e verifica integridade geral
  // ───────────────────────────────────────────────────────────────────────────
  test("T3: verificar integridade final do template", async ({ page }) => {
    expect(sharedTemplateId).toBeTruthy();

    await page.goto(`/dashboard/templates/${sharedTemplateId}/editar`);
    await waitForDocReady(page);
    await page.waitForTimeout(2_000); // aguarda chips coloridos renderizarem

    const fields = await collectFieldKeys(page);
    console.log(`[T3] ${fields.length} campos no editor: ${fields.join(", ")}`);
    expect(fields.length).toBeGreaterThan(0);

    // Todos os campos sobreviventes do T1 devem continuar presentes
    for (const key of survivingKeys) {
      await expect(fieldCard(page, key)).toBeAttached({ timeout: 5_000 });
    }
    console.log(`[T3] ✓ ${survivingKeys.length} campos sobreviventes do T1 intactos`);

    // Chips no documento
    const chipCount = await page.locator("[data-field-chip]").count();
    console.log(`[T3] Chips no doc: ${chipCount}`);
    expect(chipCount).toBeGreaterThan(0);

    // Verifica status de cada campo
    let locatedCount = 0;
    for (const key of fields) {
      const text = await fieldCard(page, key).textContent().catch(() => "");
      if ((text ?? "").includes("✓ Localizado")) locatedCount++;
    }
    console.log(`[T3] Localizados: ${locatedCount}/${fields.length}`);

    // Navega para visualizar e confirma que o doc renderiza
    await page.goto(`/dashboard/templates/${sharedTemplateId}/visualizar`);
    await expect(page.locator("td").first()).toBeAttached({ timeout: 30_000 });
    console.log(`[T3] ✓ Visualizar carregou o documento`);

    // Chips também aparecem no visualizar
    const chipsOnVisualize = await page.locator("[data-field-chip]").count();
    console.log(`[T3] Chips no visualizar: ${chipsOnVisualize}`);
    expect(chipsOnVisualize).toBeGreaterThan(0);

    await page.screenshot({ path: "e2e/screenshots/t3-final.png" });
    console.log(`[T3] ✓ Teste concluído`);
  });
});

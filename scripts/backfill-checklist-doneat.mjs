// =====================================================================
// Backfill (aproximado) do campo `doneAt` nos itens de checklist das etapas
// do Kanban que foram concluídos ANTES de o sistema passar a registrar o
// horário de conclusão de cada atividade.
//
// Regra de estimativa (por etapa, NÃO 100% precisa — é uma base):
//   Para cada item com done=true e SEM doneAt, na ordem do checklist:
//     - o k-ésimo item recebe a data do k-ésimo anexo da etapa
//       (kanban_attachments, ordenados por createdAt asc) — "documentos";
//     - itens além da quantidade de anexos recebem completedAt (ou startedAt)
//       da própria etapa (kanban_stage_progress) — "atividades sem anexo".
//   Itens que já têm doneAt NÃO são tocados. Itens não concluídos idem.
//   Se a etapa não tem nenhuma data base nem anexo, o item fica como está.
//
// Execução (a partir da raiz do projeto, com DATABASE_URL no ambiente/.env):
//   $ node scripts/backfill-checklist-doneat.mjs            # DRY-RUN (não grava)
//   $ node scripts/backfill-checklist-doneat.mjs --apply    # grava de fato
//
// Idempotente: rodar de novo não altera itens que já receberam doneAt.
// =====================================================================
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.slice(2).includes('--apply');

// --- núcleo puro (mesma lógica coberta por testes) ---
function backfillChecklist(checklist, { completedAt, startedAt, attachments }) {
  if (!Array.isArray(checklist) || checklist.length === 0) return { changed: false, checklist, applied: [] };
  const stageBase = completedAt || startedAt || null;
  const attDates = (attachments || [])
    .map(a => a.createdAt).filter(Boolean)
    .map(d => new Date(d)).filter(d => !isNaN(d.getTime()))
    .sort((a, b) => a - b);
  const targets = [];
  checklist.forEach((it, i) => { if (it && it.done === true && !it.doneAt) targets.push(i); });
  if (targets.length === 0) return { changed: false, checklist, applied: [] };

  const out = checklist.map(it => ({ ...it }));
  const applied = [];
  targets.forEach((idx, k) => {
    let dt = null;
    if (k < attDates.length) dt = attDates[k];                       // documento (anexo) na ordem
    else if (stageBase) dt = new Date(stageBase);                    // data da etapa
    else if (attDates.length) dt = attDates[attDates.length - 1];    // fallback: último anexo
    if (dt && !isNaN(dt.getTime())) {
      const iso = dt.toISOString();
      out[idx].doneAt = iso;
      applied.push({ label: out[idx].label, doneAt: iso });
    }
  });
  return { changed: applied.length > 0, checklist: out, applied };
}

async function main() {
  console.log(APPLY ? '>> MODO APPLY: as alterações serão gravadas.\n' : '>> DRY-RUN: nada será gravado. Use --apply para gravar.\n');

  const stages = await prisma.kanbanStageProgress.findMany({
    include: { attachments: { select: { createdAt: true } } },
  });

  let etapasAfetadas = 0, itensAfetados = 0;
  for (const sp of stages) {
    const res = backfillChecklist(sp.checklist, {
      completedAt: sp.completedAt,
      startedAt: sp.startedAt,
      attachments: sp.attachments,
    });
    if (!res.changed) continue;
    etapasAfetadas++;
    itensAfetados += res.applied.length;
    console.log(`etapa ${sp.stage} (spId=${sp.id}) — ${res.applied.length} item(ns):`);
    for (const a of res.applied) console.log(`   • ${a.label} -> ${a.doneAt}`);
    if (APPLY) {
      await prisma.kanbanStageProgress.update({
        where: { id: sp.id },
        data: { checklist: res.checklist },
      });
    }
  }

  console.log(`\nResumo: ${itensAfetados} item(ns) em ${etapasAfetadas} etapa(s)` +
    (APPLY ? ' — GRAVADO.' : ' — (dry-run, nada gravado).'));
}

main()
  .catch(e => { console.error('ERRO:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

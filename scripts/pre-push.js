// =====================================================================
// Roda ANTES de `prisma db push` no build do Render. Aplica conversoes
// de tipo que o Prisma sozinho recusa (enum -> text), preservando dados.
// Idempotente: pode rodar sempre, faz nada se ja estiver convertido.
// =====================================================================
import 'dotenv/config';
import pg from 'pg';

const sql = `
DO $$ BEGIN
  -- kanban_cards.currentStage  enum -> TEXT
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='kanban_cards' AND column_name='currentStage'
      AND udt_name = 'KanbanStage'
  ) THEN
    ALTER TABLE kanban_cards
      ALTER COLUMN "currentStage" TYPE TEXT USING "currentStage"::text;
  END IF;

  -- kanban_stage_progress.stage  enum -> TEXT
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='kanban_stage_progress' AND column_name='stage'
      AND udt_name = 'KanbanStage'
  ) THEN
    ALTER TABLE kanban_stage_progress
      ALTER COLUMN stage TYPE TEXT USING stage::text;
  END IF;

  -- parceiros.stages  enum[] -> TEXT[]
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='parceiros' AND column_name='stages'
      AND udt_name = '_KanbanStage'
  ) THEN
    ALTER TABLE parceiros
      ALTER COLUMN stages TYPE TEXT[] USING stages::TEXT[];
  END IF;

  -- kanban_stage_configs.stage  enum -> TEXT (a tabela vai ser dropada
  -- pelo Prisma depois, mas precisamos quebrar a dependência primeiro)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='kanban_stage_configs' AND column_name='stage'
      AND udt_name = 'KanbanStage'
  ) THEN
    ALTER TABLE kanban_stage_configs
      ALTER COLUMN stage TYPE TEXT USING stage::text;
  END IF;

  -- role_permissions: troca o unique antigo (role, module) e adiciona partnerType.
  -- Como a estrutura mudou bastante, dropamos a tabela e deixamos o Prisma recriar.
  -- Os defaults populam automaticamente no primeiro acesso ao endpoint.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='role_permissions') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='role_permissions' AND column_name='partnerType'
    ) THEN
      DROP TABLE role_permissions CASCADE;
    END IF;
  END IF;
END $$;
`;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.warn('[pre-push] DATABASE_URL nao definida; pulando.');
    return;
  }
  const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    await c.query(sql);
    console.log('[pre-push] Conversoes de tipo OK.');
    // Dropa o enum antigo se ja nao houver coluna usando-o
    try {
      await c.query('DROP TYPE IF EXISTS "KanbanStage";');
      console.log('[pre-push] Enum KanbanStage removido.');
    } catch (e) {
      // ainda em uso por algo: ok, deixa pro Prisma resolver
      console.log('[pre-push] Enum KanbanStage ainda em uso (ok).');
    }
  } catch (e) {
    console.error('[pre-push] ERRO:', e.message);
    throw e;
  } finally {
    await c.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });

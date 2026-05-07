import { listSaldos } from './saldos.service.js';

export async function listAlertas(user) {
  const saldos = await listSaldos(user);
  const alertas = [];
  for (const s of saldos) {
    if (s.situacao === 'Urgente - Comprar Saldo') {
      alertas.push({
        nivel: 'urgente', cliente_id: s.id, cliente_nome: s.nome,
        escritorio: s.escritorio, saldo: s.saldo,
        msg: `Saldo negativo (${s.saldo.toFixed(2)})`,
      });
    } else if (s.situacao === 'Alerta - Comprar saldo') {
      alertas.push({
        nivel: 'alerta', cliente_id: s.id, cliente_nome: s.nome,
        escritorio: s.escritorio, saldo: s.saldo,
        msg: `Saldo abaixo de 2x média operacional (${s.saldo.toFixed(2)})`,
      });
    }
  }
  return alertas;
}

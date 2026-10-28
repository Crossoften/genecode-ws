import { createHash } from 'node:crypto';

import { simulatedEvents } from '../../domain/shipment-tracking';
import type {
  LabelRequest,
  LabelResult,
  PickupRequest,
  PickupResult,
  ShippingOption,
  ShippingProvider,
  ShippingQuoteRequest,
  TrackingResult,
  TrackRequest,
} from '../../domain/ports/shipping-provider.port';
import { ascii } from './dhl-express.shipping.provider';

/**
 * Adapter de sandbox de logística.
 *
 * Cotação determinística por CEP: o mesmo CEP devolve sempre o mesmo preço, o
 * que torna os testes reprodutíveis. O preço cresce com a distância aproximada
 * da região — o primeiro dígito do CEP —, o suficiente para exercitar a tela.
 *
 * As duas modalidades existem porque a decisão F5 manteve o Express: como o
 * frete é pago pelo cliente, faz sentido ele escolher.
 *
 * Desde o GC-AJ-042 também simula o resto da jornada sem transportadora:
 * etiqueta em PDF (marcada como teste), rastreio que anda com o relógio e
 * coleta agendada — ida e volta, como pedido em 26/10.
 */
export class SandboxShippingProvider implements ShippingProvider {
  constructor(
    private readonly minutesPerStep = 5,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async quote(request: ShippingQuoteRequest): Promise<ShippingOption[]> {
    const zip = request.destinationZipCode.replace(/\D/g, '');
    // Primeiro dígito do CEP indica a região; 0 é São Paulo capital.
    const region = Number(zip[0] ?? '0');
    const base = 1_890 + region * 320;
    const weightFactor = Math.ceil(request.weightGrams / 200) * 90;

    return [
      {
        code: 'STANDARD',
        name: 'Padrão',
        priceCents: base + weightFactor,
        estimatedDays: 6 + region,
      },
      {
        code: 'EXPRESS',
        name: 'Express',
        priceCents: Math.round((base + weightFactor) * 2.1),
        estimatedDays: 2 + Math.floor(region / 3),
      },
    ];
  }

  async createLabel(request: LabelRequest): Promise<LabelResult> {
    // Formato dos Correios: 2 letras + 9 dígitos + BR. Derivado por hash para
    // ser estável entre execuções com o mesmo pedido.
    const seed = `${request.orderNumber}${request.reverse ? 'R' : 'O'}`;
    const digits = createHash('sha256').update(seed).digest('hex').replace(/\D/g, '').slice(0, 9);
    const trackingCode = `${request.reverse ? 'LR' : 'LO'}${digits.padEnd(9, '0')}BR`;

    const lines = [
      'ETIQUETA DE TESTE - SEM VALOR DE ENVIO',
      `Pedido ${request.orderNumber} - ${request.reverse ? 'VOLTA (amostra)' : 'IDA (kit)'}`,
      `Rastreio ${trackingCode}`,
      '',
      'REMETENTE',
      ...partyLines(request.from),
      '',
      'DESTINATARIO',
      ...partyLines(request.to),
    ];
    return {
      trackingCode,
      label: { format: 'PDF', base64: simplePdf(lines).toString('base64') },
    };
  }

  async track(request: TrackRequest): Promise<TrackingResult> {
    return {
      trackingCode: request.trackingCode,
      events: simulatedEvents(request, this.now(), this.minutesPerStep),
    };
  }

  async schedulePickup(request: PickupRequest): Promise<PickupResult> {
    const suffix = createHash('sha256')
      .update(`${request.orderNumber}${request.date}`)
      .digest('hex')
      .slice(0, 8)
      .toUpperCase();
    return { confirmationNumber: `SBX${suffix}`, readyByTime: request.readyTime };
  }
}

function partyLines(party: LabelRequest['from']): string[] {
  if (!party) return ['(nao informado)'];
  return [
    party.name,
    `${party.street}, ${party.number}${party.complement ? ` - ${party.complement}` : ''}`,
    `${party.district ? `${party.district} - ` : ''}${party.city}/${party.state}`,
    `CEP ${party.zipCode}`,
  ];
}

/**
 * PDF mínimo de uma página com texto em Helvetica — o bastante para a etiqueta
 * de teste abrir em qualquer leitor e ser impressa. Sem dependência.
 */
export function simplePdf(lines: readonly string[]): Buffer {
  const escape = (text: string) => ascii(text).replace(/[\\()]/g, (char) => `\\${char}`);
  const content = [
    'BT',
    '/F1 14 Tf',
    '50 780 Td',
    '18 TL',
    ...lines.map((line) => `(${escape(line)}) '`),
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

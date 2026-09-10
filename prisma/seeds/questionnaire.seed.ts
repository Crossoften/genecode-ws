import { PrismaClient, type Checkpoint } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Perguntas do questionário ambiental.
 *
 * ### Performance — as 120 do material do cliente
 *
 * Decisão 23 do André em 09/09: valem as perguntas do mockup, 5 checkpoints ×
 * 24 perguntas (4 por bloco genético). Elas moram em `data/questionario-
 * performance.json` porque são conteúdo do laboratório, não código — o mesmo
 * tratamento que o painel genético já recebe.
 *
 * A pontuação NÃO vem do JSON: ela é derivada da POSIÇÃO da opção, como manda a
 * §3.3 da especificação (1ª=100, 2ª=66,7, 3ª=33,3, 4ª=0), e as opções já chegam
 * ordenadas da melhor para a pior. Guardar os pontos no arquivo abriria espaço
 * para o texto e a nota saírem de sincronia na primeira revisão de conteúdo.
 * Peso 1 em todas: a §3.4 diz que as 4 perguntas do bloco pesam igual (25%).
 *
 * ### Nutrigenética — ainda exemplos
 *
 * O cliente só entregou o banco de perguntas do painel de performance. As de
 * nutrigenética seguem sendo um ponto de partida, sem checkpoint (valem para
 * Q0–Q4), até o laboratório mandar as definitivas — ele repesa e adiciona pelo
 * próprio admin, sem deploy (decisão B5).
 *
 * Idempotente por (painel, checkpoint, categoria, ordem): reexecutar atualiza o
 * texto/peso e regrava as opções, sem duplicar.
 */
interface SeedOption {
  readonly label: string;
  readonly points: number;
}
interface SeedQuestion {
  readonly checkpoint: Checkpoint | null;
  readonly categorySlug: string;
  readonly order: number;
  readonly text: string;
  readonly weight: number;
  readonly options: readonly SeedOption[];
}

/** Uma pergunta do arquivo do cliente: opções ordenadas da melhor para a pior. */
interface PerformanceQuestionJson {
  readonly checkpoint: Checkpoint;
  readonly categorySlug: string;
  readonly order: number;
  readonly text: string;
  readonly options: readonly string[];
}

const MAX_POINTS = 100;

/**
 * Pontos de uma opção pela sua posição (§3.3 da especificação).
 *
 * Generalizado para N opções para não quebrar caso o laboratório publique um
 * bloco com 3 ou 5 alternativas: a primeira sempre vale 100, a última 0, e as do
 * meio se distribuem por igual. Com 4 opções dá exatamente 100 / 66,7 / 33,3 / 0.
 */
function pointsByPosition(index: number, total: number): number {
  if (total <= 1) return MAX_POINTS;
  return Math.round((1 - index / (total - 1)) * MAX_POINTS * 10) / 10;
}

/**
 * Textos das 6 perguntas de exemplo que o seed antigo criou para performance.
 *
 * Elas nasceram sem checkpoint, então continuariam aparecendo em TODOS os
 * checkpoints ao lado das 120 reais, inflando cada bloco. Apagadas pelo texto —
 * e não por ordem ou por "tudo que é performance sem checkpoint" — para não
 * levar junto nada que o laboratório tenha criado pelo admin.
 */
const PERFORMANCE_EXEMPLOS_LEGADO: readonly string[] = [
  'Você inclui treino de força na sua rotina?',
  'Com que frequência você faz treino aeróbico (corrida, bike, natação)?',
  'Como é sua recuperação entre treinos (sono e descanso)?',
  'Você faz aquecimento e trabalho de mobilidade antes de treinar?',
  'Como está sua alimentação voltada à composição corporal?',
  'Qual seu nível de estresse e foco no dia a dia?',
];

const NUTRI_EXEMPLOS: readonly Omit<SeedQuestion, 'checkpoint' | 'order'>[] = [
  {
    categorySlug: 'metabolismo_energetico',
    text: 'Com que frequência você pratica atividade física na semana?',
    weight: 1.5,
    options: [
      { label: 'Não pratico', points: 0 },
      { label: '1 a 2 vezes', points: 40 },
      { label: '3 a 4 vezes', points: 75 },
      { label: '5 vezes ou mais', points: 100 },
    ],
  },
  {
    categorySlug: 'saude_cardiometabolica',
    text: 'Como está seu consumo de sódio e alimentos ultraprocessados?',
    weight: 1.2,
    options: [
      { label: 'Alto, quase todo dia', points: 0 },
      { label: 'Moderado', points: 50 },
      { label: 'Baixo, evito', points: 100 },
    ],
  },
  {
    categorySlug: 'micronutrientes',
    text: 'Sua alimentação inclui variedade de frutas, verduras e legumes?',
    weight: 1,
    options: [
      { label: 'Raramente', points: 0 },
      { label: 'Algumas vezes na semana', points: 50 },
      { label: 'Diariamente', points: 100 },
    ],
  },
  {
    categorySlug: 'detox_biotransformacao',
    text: 'Qual seu consumo de álcool por semana?',
    weight: 1,
    options: [
      { label: 'Diário', points: 0 },
      { label: '3 a 4 doses', points: 40 },
      { label: 'Social ou raro', points: 80 },
      { label: 'Não bebo', points: 100 },
    ],
  },
  {
    categorySlug: 'neuronutricao',
    text: 'Como você avalia a qualidade do seu sono?',
    weight: 1,
    options: [
      { label: 'Ruim, durmo mal', points: 0 },
      { label: 'Regular', points: 50 },
      { label: 'Boa, sono reparador', points: 100 },
    ],
  },
];

/** Lê as 120 perguntas do arquivo do cliente e converte para o formato do seed. */
function loadPerformance(): SeedQuestion[] {
  const file = join(__dirname, 'data', 'questionario-performance.json');
  const parsed = JSON.parse(readFileSync(file, 'utf-8')) as PerformanceQuestionJson[];

  return parsed.map((question) => ({
    checkpoint: question.checkpoint,
    categorySlug: question.categorySlug,
    order: question.order,
    text: question.text,
    weight: 1,
    options: question.options.map((label, index) => ({
      label,
      points: pointsByPosition(index, question.options.length),
    })),
  }));
}

async function seedPanel(
  prisma: PrismaClient,
  panelSlug: string,
  questions: readonly SeedQuestion[],
): Promise<void> {
  for (const q of questions) {
    const existing = await prisma.environmentalQuestion.findFirst({
      where: {
        panelSlug,
        checkpoint: q.checkpoint,
        categorySlug: q.categorySlug,
        order: q.order,
      },
    });

    const options = {
      create: q.options.map((o, i) => ({ label: o.label, points: o.points, order: i })),
    };

    if (existing) {
      await prisma.environmentalOption.deleteMany({ where: { questionId: existing.id } });
      await prisma.environmentalQuestion.update({
        where: { id: existing.id },
        data: { text: q.text, weight: q.weight, active: true, options },
      });
    } else {
      await prisma.environmentalQuestion.create({
        data: {
          panelSlug,
          checkpoint: q.checkpoint,
          categorySlug: q.categorySlug,
          text: q.text,
          weight: q.weight,
          order: q.order,
          active: true,
          options,
        },
      });
    }
  }
}

/** Semeia as perguntas ambientais dos dois painéis. Idempotente. */
export async function seedQuestionnaire(prisma: PrismaClient): Promise<void> {
  await prisma.environmentalQuestion.deleteMany({
    where: {
      panelSlug: 'performance',
      checkpoint: null,
      text: { in: [...PERFORMANCE_EXEMPLOS_LEGADO] },
    },
  });

  const nutri: SeedQuestion[] = NUTRI_EXEMPLOS.map((q, order) => ({
    ...q,
    checkpoint: null,
    order,
  }));
  const performance = loadPerformance();

  await seedPanel(prisma, 'nutrigenetics', nutri);
  await seedPanel(prisma, 'performance', performance);

  console.log(
    `✓ questionário ambiental: ${performance.length} perguntas de performance (Q0–Q4) e ${nutri.length} exemplos de nutrigenética`,
  );
}

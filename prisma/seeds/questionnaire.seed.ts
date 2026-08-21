import { PrismaClient } from '@prisma/client';

/**
 * Perguntas de exemplo do questionário ambiental, uma por grupo genético.
 *
 * O peso ambiental de cada painel entra no score ajustado pela estratégia já
 * validada (aditiva em performance, multiplicativa em nutrigenética): cada opção
 * vale de 0 (pior hábito) a 100 (melhor), e o peso da pergunta pondera a média
 * dentro da categoria. Estas são um ponto de partida — o admin/laboratório
 * repesa e adiciona pelo próprio painel, sem deploy (decisão B5).
 *
 * Idempotente por (painel, categoria, ordem): reexecutar atualiza o texto/peso e
 * regrava as opções, sem duplicar.
 */
interface SeedOption {
  readonly label: string;
  readonly points: number;
}
interface SeedQuestion {
  readonly categorySlug: string;
  readonly text: string;
  readonly weight: number;
  readonly options: readonly SeedOption[];
}

const NUTRI: readonly SeedQuestion[] = [
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

const PERFORMANCE: readonly SeedQuestion[] = [
  {
    categorySlug: 'forca_potencia',
    text: 'Você inclui treino de força na sua rotina?',
    weight: 1.3,
    options: [
      { label: 'Não treino força', points: 0 },
      { label: '1 vez por semana', points: 40 },
      { label: '2 a 3 vezes', points: 80 },
      { label: '4 vezes ou mais', points: 100 },
    ],
  },
  {
    categorySlug: 'resistencia_aerobica',
    text: 'Com que frequência você faz treino aeróbico (corrida, bike, natação)?',
    weight: 1.2,
    options: [
      { label: 'Nunca', points: 0 },
      { label: '1 vez por semana', points: 40 },
      { label: '2 a 3 vezes', points: 80 },
      { label: '4 vezes ou mais', points: 100 },
    ],
  },
  {
    categorySlug: 'recuperacao_inflamacao',
    text: 'Como é sua recuperação entre treinos (sono e descanso)?',
    weight: 1,
    options: [
      { label: 'Insuficiente', points: 0 },
      { label: 'Parcial', points: 50 },
      { label: 'Adequada', points: 100 },
    ],
  },
  {
    categorySlug: 'risco_lesao',
    text: 'Você faz aquecimento e trabalho de mobilidade antes de treinar?',
    weight: 1,
    options: [
      { label: 'Nunca', points: 0 },
      { label: 'Às vezes', points: 50 },
      { label: 'Sempre', points: 100 },
    ],
  },
  {
    categorySlug: 'metabolismo_composicao',
    text: 'Como está sua alimentação voltada à composição corporal?',
    weight: 1,
    options: [
      { label: 'Desregrada', points: 0 },
      { label: 'Razoável', points: 50 },
      { label: 'Controlada e planejada', points: 100 },
    ],
  },
  {
    categorySlug: 'neuroperformance',
    text: 'Qual seu nível de estresse e foco no dia a dia?',
    weight: 1,
    options: [
      { label: 'Estresse alto, foco baixo', points: 0 },
      { label: 'Moderado', points: 50 },
      { label: 'Controlado, bom foco', points: 100 },
    ],
  },
];

async function seedPanel(
  prisma: PrismaClient,
  panelSlug: string,
  questions: readonly SeedQuestion[],
): Promise<void> {
  for (let order = 0; order < questions.length; order += 1) {
    const q = questions[order];
    const existing = await prisma.environmentalQuestion.findFirst({
      where: { panelSlug, categorySlug: q.categorySlug, order },
    });

    if (existing) {
      await prisma.environmentalOption.deleteMany({ where: { questionId: existing.id } });
      await prisma.environmentalQuestion.update({
        where: { id: existing.id },
        data: {
          text: q.text,
          weight: q.weight,
          active: true,
          options: {
            create: q.options.map((o, i) => ({ label: o.label, points: o.points, order: i })),
          },
        },
      });
    } else {
      await prisma.environmentalQuestion.create({
        data: {
          panelSlug,
          categorySlug: q.categorySlug,
          text: q.text,
          weight: q.weight,
          order,
          active: true,
          options: {
            create: q.options.map((o, i) => ({ label: o.label, points: o.points, order: i })),
          },
        },
      });
    }
  }
}

/** Semeia as perguntas ambientais dos dois painéis. Idempotente. */
export async function seedQuestionnaire(prisma: PrismaClient): Promise<void> {
  await seedPanel(prisma, 'nutrigenetics', NUTRI);
  await seedPanel(prisma, 'performance', PERFORMANCE);
  console.log(`✓ questionário ambiental: ${NUTRI.length + PERFORMANCE.length} perguntas de exemplo`);
}

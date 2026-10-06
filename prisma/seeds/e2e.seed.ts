import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';

/**
 * Fixtures do teste de ponta a ponta com o cliente (jornadas do laboratório e
 * do treinador).
 *
 * ### Por que existe separado do seed de QA
 *
 * O caderno de QA semeia uma paciente com laudo, pedidos e kits — ótimo para
 * testar telas, péssimo para demonstrar *a chegada do resultado*, que é
 * justamente o que o cliente quer ver. Aqui as contas nascem **sem laudo**, para
 * que o resultado apareça na frente de quem está assistindo.
 *
 * ### O que cria
 *
 * Dois conjuntos, com o mesmo formato:
 *
 * - **demo** — as contas que percorremos no passo a passo documentado.
 * - **cliente** — contas limpas e equivalentes, para o cliente repetir sozinho.
 *   A da jornada do treinador já nasce com o treinador vinculado e autorizado,
 *   porque o que o cliente vai exercitar ali é a avaliação, não o vínculo.
 *
 * ⚠️ Cria contas com senha conhecida. Só roda com `SEED_E2E=YES`, e nunca deve
 * ser executado em produção.
 */
const prisma = new PrismaClient();

const SENHA = 'GeneCodeE2E2026!';

interface Conta {
  readonly email: string;
  readonly nome: string;
  readonly papeis: readonly string[];
}

/** Um par paciente + código de amostra, que é a unidade das duas jornadas. */
interface Jornada {
  readonly rotulo: string;
  readonly paciente: Conta;
  readonly codigoAmostra: string;
  /** Quando presente, cria o treinador e já autoriza o compartilhamento. */
  readonly treinador?: Conta;
}

const JORNADAS: readonly Jornada[] = [
  {
    rotulo: 'DEMO · laboratório',
    paciente: { email: 'e2e.paciente@genecode.test', nome: 'Helena Barreto', papeis: ['patient'] },
    codigoAmostra: 'E2E-LAB-001',
  },
  {
    rotulo: 'DEMO · treinador',
    paciente: { email: 'e2e.aluno@genecode.test', nome: 'Rodrigo Salles', papeis: ['patient'] },
    codigoAmostra: 'E2E-TRE-001',
    treinador: {
      email: 'e2e.treinador@genecode.test',
      nome: 'Patrícia Lemos',
      papeis: ['professional'],
    },
  },
  {
    rotulo: 'CLIENTE · laboratório',
    paciente: {
      email: 'cliente.paciente@genecode.test',
      nome: 'Antônio Ferraz',
      papeis: ['patient'],
    },
    codigoAmostra: 'CLI-LAB-001',
  },
  {
    rotulo: 'CLIENTE · treinador',
    paciente: {
      email: 'cliente.aluno@genecode.test',
      nome: 'Beatriz Monteiro',
      papeis: ['patient'],
    },
    codigoAmostra: 'CLI-TRE-001',
    treinador: {
      email: 'cliente.treinador@genecode.test',
      nome: 'Sérgio Amaral',
      papeis: ['professional'],
    },
  },
];

async function criarConta(conta: Conta): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email: conta.email },
    update: { status: 'ACTIVE', emailVerifiedAt: new Date() },
    create: {
      email: conta.email,
      name: conta.nome,
      password: await hash(SENHA, 12),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  for (const slug of conta.papeis) {
    const role = await prisma.role.findUnique({ where: { slug } });
    if (!role) throw new Error(`Papel "${slug}" não existe. Rode o seed principal antes.`);
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }

  return user.id;
}

async function main(): Promise<void> {
  if (process.env.SEED_E2E !== 'YES') {
    console.error(
      'Recusando rodar. Este seed cria contas com senha conhecida.\n' +
        'Para rodar de propósito: SEED_E2E=YES npx ts-node -r tsconfig-paths/register prisma/seeds/e2e.seed.ts',
    );
    process.exitCode = 1;
    return;
  }

  console.log('Semeando as contas do teste de ponta a ponta…\n');

  for (const jornada of JORNADAS) {
    const pacienteId = await criarConta(jornada.paciente);

    // A amostra é criada **sem laudo**: é o upload do laboratório que produz o
    // resultado, e é exatamente isso que a demonstração precisa mostrar
    // acontecendo.
    const subject = await prisma.subject.upsert({
      where: { externalCode: jornada.codigoAmostra },
      update: {},
      create: { externalCode: jornada.codigoAmostra },
    });

    await prisma.subjectLink.upsert({
      where: { userId_subjectId: { userId: pacienteId, subjectId: subject.id } },
      update: {},
      create: { userId: pacienteId, subjectId: subject.id, relation: 'SELF' },
    });

    console.log(`${jornada.rotulo}`);
    console.log(`  paciente  ${jornada.paciente.email}`);
    console.log(`  amostra   ${jornada.codigoAmostra}`);

    if (jornada.treinador) {
      const treinadorId = await criarConta(jornada.treinador);

      const perfil = await prisma.professionalProfile.upsert({
        where: { userId: treinadorId },
        update: {},
        create: {
          userId: treinadorId,
          specialty: 'Educação Física',
          councilId: 'CREF 012345-G/SP',
          bio: 'Treinamento de força e condicionamento.',
        },
      });

      // Já nasce AUTHORIZED: o que se quer exercitar nesta jornada é a
      // avaliação do treinador, não o fluxo de pedir e conceder acesso — que
      // tem caderno próprio.
      await prisma.dataSharing.upsert({
        where: { subjectId_professionalId: { subjectId: subject.id, professionalId: perfil.id } },
        update: { status: 'AUTHORIZED', authorizedAt: new Date() },
        create: {
          subjectId: subject.id,
          professionalId: perfil.id,
          status: 'AUTHORIZED',
          initiatedBy: 'PATIENT',
          authorizedAt: new Date(),
        },
      });

      console.log(`  treinador ${jornada.treinador.email} (acesso já autorizado)`);
    }
    console.log('');
  }

  console.log(`Senha de todas as contas: ${SENHA}`);
  console.log('\n⚠️  Ambiente de homologação. Nenhuma destas contas deve existir em produção.');
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

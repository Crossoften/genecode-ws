import type { PrismaClient } from '@prisma/client';

/**
 * Documentos legais versionados.
 *
 * O texto aceito é **copiado** para cá, não referenciado por link. Anos depois é
 * preciso poder provar exatamente a que a pessoa consentiu — e um link aponta
 * para a versão de hoje, não para a de então.
 *
 * O conteúdo abaixo é um esqueleto: o texto jurídico definitivo tem de vir do
 * cliente. Publicar uma versão nova é adicionar uma entrada com `version`
 * incrementada, nunca editar a existente.
 */
const DOCUMENTS = [
  {
    type: 'TERMS_OF_USE' as const,
    version: '1.0',
    content:
      '# Termos de Uso\n\n_Minuta preliminar — aguardando texto jurídico definitivo do cliente._\n\n' +
      'Ao criar uma conta na GeneCode, você concorda com a coleta e o processamento da sua ' +
      'amostra biológica para a finalidade do exame contratado.',
  },
  {
    type: 'PRIVACY_POLICY' as const,
    version: '1.0',
    content:
      '# Política de Privacidade\n\n_Minuta preliminar — aguardando texto jurídico definitivo._\n\n' +
      'Seus dados genéticos são dados pessoais sensíveis nos termos da LGPD (Lei 13.709/2018). ' +
      'Eles são armazenados de forma segregada da sua identidade e nunca são compartilhados sem ' +
      'o seu consentimento explícito, que pode ser revogado a qualquer momento.',
  },
  {
    type: 'GENETIC_DATA_PROCESSING' as const,
    version: '1.0',
    content:
      '# Consentimento para Tratamento de Dado Genético\n\n_Minuta preliminar._\n\n' +
      'Autorizo a análise da minha amostra biológica para geração do laudo genético contratado. ' +
      'Estou ciente de que o laudo é ferramenta de autoconhecimento e não substitui avaliação ' +
      'médica, e de que posso solicitar a exclusão dos meus dados a qualquer momento.',
  },
];

/** Semeia os documentos legais. Idempotente por tipo + versão. */
export async function seedConsentDocuments(prisma: PrismaClient): Promise<void> {
  for (const document of DOCUMENTS) {
    await prisma.consentDocument.upsert({
      where: { type_version: { type: document.type, version: document.version } },
      update: {},
      create: { ...document, publishedAt: new Date() },
    });
  }
  console.log(`✓ ${DOCUMENTS.length} documentos legais (minutas preliminares)`);
}

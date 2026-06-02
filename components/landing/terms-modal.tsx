"use client";

import { useState } from "react";
import { X } from "lucide-react";

export function TermsLink() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-slate-400 underline-offset-2 transition hover:text-slate-200 hover:underline text-xs"
      >
        Termos de Uso &amp; Privacidade
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-8 py-5">
              <div>
                <h2 className="text-lg font-bold text-slate-950">Termos de Uso &amp; Política de Privacidade</h2>
                <p className="text-xs text-slate-400">PlanoMagistra · Última atualização: maio de 2026</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl border border-slate-200 p-2 text-slate-400 transition hover:border-slate-950 hover:text-slate-950"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-8 px-8 py-7 text-sm leading-relaxed text-slate-700">

              <section>
                <h3 className="mb-3 text-base font-bold text-slate-950">1. Aceitação dos Termos</h3>
                <p>Ao acessar ou utilizar a plataforma PlanoMagistra, você declara ter lido, compreendido e concordado com estes Termos de Uso e com nossa Política de Privacidade. Caso não concorde com qualquer disposição aqui presente, por favor, não utilize nossos serviços.</p>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-slate-950">2. Descrição do Serviço</h3>
                <p>O PlanoMagistra é uma plataforma SaaS destinada a professores da educação básica brasileira que auxilia na criação e preenchimento de planos de aula. Por meio da assistente pedagógica de inteligência artificial <strong>Magis</strong>, o sistema analisa o template (modelo) de plano de aula fornecido pelo usuário e sugere conteúdos pedagógicos alinhados à BNCC (Base Nacional Comum Curricular), ao SAEB (Sistema de Avaliação da Educação Básica) e ao currículo específico de cada território nacional, campo a campo, no editor split-view.</p>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-slate-950">3. Cadastro e Conta</h3>
                <p className="mb-2">Para utilizar o PlanoMagistra, você deve criar uma conta fornecendo informações verídicas, incluindo nome, endereço de e-mail e, opcionalmente, o nome da instituição de ensino. Você é responsável por:</p>
                <ul className="list-inside list-disc space-y-1 text-slate-600">
                  <li>Manter a confidencialidade de suas credenciais de acesso;</li>
                  <li>Todas as atividades realizadas sob sua conta;</li>
                  <li>Notificar imediatamente o PlanoMagistra em caso de uso não autorizado.</li>
                </ul>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-slate-950">4. Planos e Limites de Uso</h3>
                <p className="mb-2">O PlanoMagistra oferece diferentes planos de assinatura (Explorador, Educador, Mestre, Regente e Escola), cada um com limites de templates e planos de aula por mês. O plano gratuito <strong>Explorador</strong> permite 1 template e 1 plano por mês, vinculados ao e-mail de cadastro. Os limites são renovados no início de cada mês civil. A contratação de planos pagos estará disponível em versões futuras do produto.</p>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-slate-950">5. Uso Aceitável</h3>
                <p className="mb-2">Você concorda em utilizar o PlanoMagistra exclusivamente para fins pedagógicos legítimos. É vedado:</p>
                <ul className="list-inside list-disc space-y-1 text-slate-600">
                  <li>Utilizar o serviço para gerar conteúdo ofensivo, discriminatório ou ilegal;</li>
                  <li>Reproduzir, revender ou distribuir os planos gerados com fins comerciais sem autorização;</li>
                  <li>Tentar acessar sistemas, dados ou contas de outros usuários;</li>
                  <li>Realizar engenharia reversa, descompilar ou extrair o código-fonte da plataforma;</li>
                  <li>Utilizar meios automatizados para acessar o serviço em volumes que excedam o uso humano normal.</li>
                </ul>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-slate-950">6. Propriedade Intelectual</h3>
                <p>O PlanoMagistra, incluindo seu código-fonte, design, marca, logotipo e a assistente Magis, são de propriedade exclusiva de seus desenvolvedores e estão protegidos pelas leis de propriedade intelectual brasileiras e internacionais. Os planos de aula gerados a partir dos templates e do conteúdo inserido pelo usuário pertencem ao próprio usuário, respeitando os direitos autorais dos documentos originais fornecidos pelas instituições de ensino.</p>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-slate-950">7. Coleta e Tratamento de Dados Pessoais (LGPD)</h3>
                <p className="mb-2">Em conformidade com a <strong>Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 — LGPD)</strong>, o PlanoMagistra coleta e trata os seguintes dados:</p>
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-bold text-slate-700">Dado</th>
                        <th className="px-4 py-2.5 text-left font-bold text-slate-700">Finalidade</th>
                        <th className="px-4 py-2.5 text-left font-bold text-slate-700">Base Legal (LGPD)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[
                        ["Nome e e-mail", "Identificação e autenticação na plataforma", "Execução de contrato (Art. 7º, V)"],
                        ["Nome da escola/instituição", "Personalização do serviço e emissão de planos", "Legítimo interesse (Art. 7º, IX)"],
                        ["Templates enviados (PDF/DOCX)", "Extração de estrutura para geração de planos", "Execução de contrato (Art. 7º, V)"],
                        ["Conteúdo dos planos gerados", "Prestação do serviço e histórico do usuário", "Execução de contrato (Art. 7º, V)"],
                        ["Dados de uso e navegação", "Melhorias do produto e segurança", "Legítimo interesse (Art. 7º, IX)"],
                        ["Chamados de suporte", "Atendimento ao usuário", "Execução de contrato (Art. 7º, V)"],
                      ].map(([dado, fin, base], i) => (
                        <tr key={i} className="bg-white">
                          <td className="px-4 py-2.5 font-medium text-slate-700">{dado}</td>
                          <td className="px-4 py-2.5 text-slate-600">{fin}</td>
                          <td className="px-4 py-2.5 text-slate-500">{base}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-slate-600">Não coletamos dados sensíveis de alunos. Os planos de aula são de responsabilidade do professor/usuário. Recomendamos não incluir dados pessoais identificáveis de alunos nos campos de texto.</p>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-slate-950">8. Compartilhamento de Dados com Terceiros</h3>
                <p className="mb-2">Para a prestação do serviço, compartilhamos dados com os seguintes fornecedores de confiança, todos com políticas de privacidade compatíveis com a LGPD e GDPR:</p>
                <ul className="list-inside list-disc space-y-1 text-slate-600">
                  <li><strong>Google Firebase / Firestore</strong> — autenticação de usuários e armazenamento de dados (servidores localizados no Brasil e EUA, com cláusulas contratuais padrão);</li>
                  <li><strong>Google Gemini (IA)</strong> — processamento de prompts para geração de sugestões pedagógicas; não armazenamos conversas na infraestrutura do Google além do necessário para a resposta;</li>
                  <li><strong>Google Cloud Storage</strong> — armazenamento seguro dos templates enviados pelos usuários.</li>
                </ul>
                <p className="mt-2 text-slate-600">Não vendemos, alugamos nem comercializamos dados pessoais de usuários a terceiros.</p>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-slate-950">9. Segurança dos Dados</h3>
                <p>Adotamos medidas técnicas e organizacionais apropriadas para proteger seus dados contra acesso não autorizado, alteração, divulgação ou destruição. Isso inclui autenticação segura via Firebase Auth, criptografia em trânsito (HTTPS/TLS) e acesso restrito aos dados por regras de segurança do Firestore (filtradas por <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">user_id</code>). Em caso de incidente de segurança que afete dados pessoais, notificaremos a ANPD e os usuários afetados nos prazos legais.</p>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-slate-950">10. Direitos do Titular (LGPD, Art. 18)</h3>
                <p className="mb-2">Como titular de dados pessoais, você tem os seguintes direitos, exercíveis a qualquer momento:</p>
                <ul className="list-inside list-disc space-y-1 text-slate-600">
                  <li><strong>Confirmação e acesso</strong> — saber quais dados temos sobre você;</li>
                  <li><strong>Correção</strong> — corrigir dados incompletos, inexatos ou desatualizados;</li>
                  <li><strong>Anonimização, bloqueio ou eliminação</strong> — de dados desnecessários ou tratados em desconformidade;</li>
                  <li><strong>Portabilidade</strong> — receber seus dados em formato estruturado;</li>
                  <li><strong>Eliminação</strong> — solicitar a exclusão completa da sua conta e dados;</li>
                  <li><strong>Revogação do consentimento</strong> — a qualquer momento, sem prejuízo da legalidade do tratamento anterior;</li>
                  <li><strong>Oposição</strong> — ao tratamento realizado com fundamento em legítimo interesse.</li>
                </ul>
                <p className="mt-2 text-slate-600">Para exercer seus direitos, envie uma solicitação para <strong>privacidade@planomagistra.com.br</strong>. Responderemos em até 15 dias úteis.</p>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-slate-950">11. Retenção de Dados</h3>
                <p>Mantemos seus dados pelo período necessário à prestação do serviço e ao cumprimento de obrigações legais. Após o encerramento da conta, os dados pessoais serão eliminados em até 90 dias, salvo obrigação legal de retenção. Templates e planos armazenados em nuvem são excluídos no mesmo prazo.</p>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-slate-950">12. Cookies e Rastreamento</h3>
                <p>Utilizamos cookies estritamente necessários para autenticação e funcionamento da plataforma (sessão Firebase). Não utilizamos cookies de rastreamento de terceiros para publicidade comportamental.</p>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-slate-950">13. Limitação de Responsabilidade</h3>
                <p>O PlanoMagistra fornece sugestões pedagógicas geradas por IA como auxílio ao planejamento. O conteúdo gerado pela Magis deve ser revisado pelo professor antes de uso. O PlanoMagistra não se responsabiliza por eventuais imprecisões nas sugestões da IA, nem pela adequação dos planos gerados às normas específicas de cada rede de ensino.</p>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-slate-950">14. Alterações nestes Termos</h3>
                <p>Podemos atualizar estes Termos periodicamente. Notificaremos os usuários com pelo menos 15 dias de antecedência em caso de alterações materiais, por e-mail ou notificação na plataforma. O uso continuado do serviço após as alterações constitui aceite dos novos termos.</p>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold text-slate-950">15. Lei Aplicável e Foro</h3>
                <p>Estes Termos são regidos pela legislação brasileira, em especial pela LGPD (Lei nº 13.709/2018), pelo Marco Civil da Internet (Lei nº 12.965/2014) e pelo Código de Defesa do Consumidor (Lei nº 8.078/1990). Fica eleito o foro da Comarca de São Paulo/SP para dirimir quaisquer controvérsias.</p>
              </section>

              <section className="rounded-2xl bg-slate-50 p-5">
                <h3 className="mb-2 text-base font-bold text-slate-950">Contato — Encarregado de Dados (DPO)</h3>
                <p className="text-slate-600">Para dúvidas, solicitações ou reclamações relacionadas à proteção de dados:</p>
                <p className="mt-1 font-medium text-slate-800">privacidade@planomagistra.com.br</p>
                <p className="mt-1 text-xs text-slate-400">PlanoMagistra · CNPJ em processo de constituição · Brasil</p>
              </section>

            </div>
          </div>
        </div>
      )}
    </>
  );
}

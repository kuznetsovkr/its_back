const nodemailer = require("nodemailer");
const { getCertificateMailConfig } = require("../config/certificateCheckout");
const { GiftCertificateError } = require("../lib/giftCertificateRules");
let transport;
let verifiedUntil = 0;
const getTransport = () => {
  const config = getCertificateMailConfig();
  if (!config) throw new GiftCertificateError("Доставка сертификатов на email пока не настроена", "certificate_mail_unavailable", 503);
  if (!transport) transport = nodemailer.createTransport(config);
  return { transport, from: config.from };
};
const verifyCertificateMail = async () => {
  if (verifiedUntil > Date.now()) return;
  try {
    await getTransport().transport.verify();
    verifiedUntil = Date.now() + 60_000;
  } catch (_error) {
    throw new GiftCertificateError("Почтовый сервис временно недоступен. Попробуйте позже", "certificate_mail_unavailable", 503);
  }
};
const buildCertificateEmail = (certificate, code, from) => ({
  from: { name: "И ТАК СОЙДЁТ", address: from },
  to: [{ address: certificate.buyerEmail }],
  envelope: { from, to: [certificate.buyerEmail] },
  messageId: "<its-certificate-" + certificate.id + "@" + from.split("@")[1] + ">",
  subject: (certificate.testMode ? "[ТЕСТ] " : "") + "Ваш подарочный сертификат — И ТАК СОЙДЁТ",
  text: [
    "Здравствуйте, " + certificate.buyerFullName + "!",
    "", "Спасибо за покупку подарочного сертификата.",
    "Номинал: " + new Intl.NumberFormat("ru-RU").format(certificate.nominalKopecks / 100) + " ₽.",
    "Код: " + code,
    "Действует до: " + new Date(certificate.expiresAt).toISOString().slice(0, 10) + " (UTC).",
    "", "Сертификат покрывает изделие вместе с вышивкой, но не доставку.",
    "Введите код на этапе оформления заказа. Остаток можно использовать в следующих заказах.",
    "Не публикуйте код: им может воспользоваться человек, которому вы его передадите.",
    ...(certificate.testMode ? ["", "Это тестовый сертификат. Он не действует в обычных заказах."] : []),
  ].join("\n"),
  disableFileAccess: true, disableUrlAccess: true,
});
const sendCertificateEmail = async (certificate, code) => {
  const { transport: sender, from } = getTransport();
  const result = await sender.sendMail(buildCertificateEmail(certificate, code, from));
  if (result.rejected?.length || !result.accepted?.length) {
    const error = new Error("Certificate email was not accepted");
    error.code = "MAIL_REJECTED";
    throw error;
  }
};
module.exports = { buildCertificateEmail, sendCertificateEmail, verifyCertificateMail };

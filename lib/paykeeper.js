const axios = require('axios');
const qs = require('querystring');

const {
  PAYKEEPER_BASE_URL,
  PAYKEEPER_LOGIN,
  PAYKEEPER_PASSWORD,
} = process.env;

function basicAuthHeader() {
  const b64 = Buffer.from(`${PAYKEEPER_LOGIN}:${PAYKEEPER_PASSWORD}`).toString('base64');
  return { Authorization: `Basic ${b64}` };
}

async function getToken() {
  const { data } = await axios.get(`${PAYKEEPER_BASE_URL}/info/settings/token/`, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...basicAuthHeader(),
    },
    timeout: 10000,
  });
  if (!data?.token) throw new Error('PayKeeper token missing');
  return data.token;
}

/**
 * Создаёт инвойс и возвращает { invoice_id, pay_url }
 * payment: { pay_amount, clientid, orderid, client_email?, client_phone?, service_name? , cart? }
 */
async function createInvoice(payment) {
  const token = await getToken();
  const body = qs.stringify({ ...payment, token });
  const { data } = await axios.post(`${PAYKEEPER_BASE_URL}/change/invoice/preview/`, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...basicAuthHeader(),
    },
    timeout: 10000,
  });
  if (!data?.invoice_id) throw new Error('PayKeeper invoice_id missing');
  return {
    invoice_id: data.invoice_id,
    pay_url: `${PAYKEEPER_BASE_URL}/bill/${data.invoice_id}/`,
  };
}

module.exports = { createInvoice };

const axios = require('axios');
const qs = require('querystring');

const { PAYKEEPER_BASE_URL, PAYKEEPER_LOGIN, PAYKEEPER_PASSWORD } = process.env;

function basicAuthHeader() {
  const b64 = Buffer.from(`${PAYKEEPER_LOGIN}:${PAYKEEPER_PASSWORD}`).toString('base64');
  return { Authorization: `Basic ${b64}` };
}

async function getToken() {
  try {
    const url = `${PAYKEEPER_BASE_URL}/info/settings/token/`;
    console.log('[PK] GET token →', url);
    const resp = await axios.get(url, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...basicAuthHeader() },
      timeout: 10000,
      validateStatus: () => true, // не кидаем сразу
    });
    console.log('[PK] token status:', resp.status);
    if (resp.status !== 200) {
      console.error('[PK] token body:', typeof resp.data === 'string' ? resp.data.slice(0,200) : resp.data);
      throw new Error(`Token HTTP ${resp.status}`);
    }
    if (!resp.data?.token) {
      console.error('[PK] token payload w/o token:', resp.data);
      throw new Error('PayKeeper token missing');
    }
    return resp.data.token;
  } catch (e) {
    console.error('[PK] getToken error:', e.response?.status, e.response?.data || e.message);
    throw e;
  }
}

async function createInvoice(payment) {
  try {
    const token = await getToken();
    const url = `${PAYKEEPER_BASE_URL}/change/invoice/preview/`;
    const body = qs.stringify({ ...payment, token });

    console.log('[PK] POST invoice →', url, 'payment:', { ...payment, token: '***' });

    const resp = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...basicAuthHeader() },
      timeout: 10000,
      validateStatus: () => true,
    });

    console.log('[PK] invoice status:', resp.status);
    if (resp.status !== 200) {
      console.error('[PK] invoice body:', typeof resp.data === 'string' ? resp.data.slice(0,200) : resp.data);
      throw new Error(`Invoice HTTP ${resp.status}`);
    }

    const data = resp.data;
    if (!data?.invoice_id) {
      console.error('[PK] invoice payload w/o invoice_id:', data);
      throw new Error('PayKeeper invoice_id missing');
    }

    return {
      invoice_id: data.invoice_id,
      pay_url: `${PAYKEEPER_BASE_URL}/bill/${data.invoice_id}/`,
    };
  } catch (e) {
    console.error('[PK] createInvoice error:', e.response?.status, e.response?.data || e.message);
    throw e;
  }
}

module.exports = { createInvoice };

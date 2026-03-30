const nodemailer = require('nodemailer');
const { env } = require('../config/env');

let transporter;

function hasMailCredentials() {
  return Boolean(env.mailUsername && env.mailPassword);
}

function isEmailConfigured() {
  return Boolean(env.mailHost && env.mailPort && env.mailFromAddress);
}

function buildTransportConfig() {
  const secure = env.mailEncryption === 'ssl' || env.mailPort === 465;
  const requireTLS = env.mailEncryption === 'tls' && !secure;

  const config = {
    host: env.mailHost,
    port: env.mailPort,
    secure,
    requireTLS,
  };

  if (hasMailCredentials()) {
    config.auth = {
      user: env.mailUsername,
      pass: env.mailPassword,
    };
  }

  return config;
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport(buildTransportConfig());
  }

  return transporter;
}

function buildFromAddress() {
  return env.mailFromName
    ? `"${env.mailFromName}" <${env.mailFromAddress}>`
    : env.mailFromAddress;
}

async function sendEmail({ to, subject, text, html }) {
  if (!isEmailConfigured()) {
    throw new Error('Email service is not fully configured.');
  }

  const info = await getTransporter().sendMail({
    from: buildFromAddress(),
    to,
    subject,
    text,
    html,
  });

  return {
    messageId: info.messageId,
    response: info.response,
  };
}

module.exports = {
  isEmailConfigured,
  sendEmail,
};

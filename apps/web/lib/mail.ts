import "server-only";
import nodemailer from "nodemailer";

const transport = nodemailer.createTransport(process.env.SMTP_URL);

export async function sendMail(m: { to: string; subject: string; text: string }) {
  await transport.sendMail({ from: process.env.MAIL_FROM, ...m });
}

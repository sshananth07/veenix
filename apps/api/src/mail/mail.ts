import nodemailer from "nodemailer";
import { env } from "../config/env";
import { enqueue, registerJob } from "../jobs/jobs";
import { getObject } from "../storage/storage";

export interface MailJob {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; key: string; contentType: string }[];
  /** Set when the mail delivers a document, so plan 07 can record the outcome. */
  documentId?: string;
}

const transport = nodemailer.createTransport(env.SMTP_URL);

export async function sendMailNow(job: MailJob) {
  const attachments = await Promise.all((job.attachments ?? []).map(async (a) => ({ filename: a.filename, content: await getObject(a.key), contentType: a.contentType })));
  await transport.sendMail({ from: env.MAIL_FROM, to: job.to, subject: job.subject, text: job.text, attachments });
}

/** Queues an email in the caller's transaction. */
export const queueMail = (job: MailJob) => enqueue("mail.send", job);

registerJob<MailJob>("mail.send", sendMailNow);

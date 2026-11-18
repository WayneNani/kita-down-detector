import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from './config.ts';

export interface Mail {
  an: string;
  betreff: string;
  text: string;
}

export interface Mailer {
  senden(mail: Mail): Promise<void>;
}

/** Entwicklung: Mails nur auf der Konsole ausgeben. */
export class KonsolenMailer implements Mailer {
  readonly gesendet: Mail[] = [];
  async senden(mail: Mail): Promise<void> {
    this.gesendet.push(mail);
    console.log(`\n--- Mail an ${mail.an} ---\nBetreff: ${mail.betreff}\n\n${mail.text}\n---\n`);
  }
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  private readonly von: string;
  constructor(url: string, von: string) {
    this.transport = nodemailer.createTransport(url);
    this.von = von;
  }
  async senden(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.von, to: mail.an, subject: mail.betreff, text: mail.text });
  }
}

export function erstelleMailer(cfg: Config): Mailer {
  return cfg.smtpUrl ? new SmtpMailer(cfg.smtpUrl, cfg.mailFrom) : new KonsolenMailer();
}

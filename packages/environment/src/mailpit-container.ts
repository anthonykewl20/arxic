import { GenericContainer, Wait } from 'testcontainers';

const SMTP_PORT = 1025;
const API_PORT = 8025;

export type StartedMailpit = Readonly<{
  smtp: string;
  api: string;
  stop: () => Promise<void>;
}>;

export class MailpitContainer {
  async start(): Promise<StartedMailpit> {
    const container = await new GenericContainer('axllent/mailpit:v1.30.0')
      .withExposedPorts(SMTP_PORT, API_PORT)
      .withWaitStrategy(
        Wait.forAll([Wait.forListeningPorts(), Wait.forHttp('/api/v1/info', API_PORT)]),
      )
      .withStartupTimeout(30_000)
      .start();
    const host = container.getHost();
    return {
      smtp: `${host}:${container.getMappedPort(SMTP_PORT)}`,
      api: `http://${host}:${container.getMappedPort(API_PORT)}`,
      stop: async () => {
        await container.stop({ timeout: 10_000, remove: true, removeVolumes: true });
      },
    };
  }
}

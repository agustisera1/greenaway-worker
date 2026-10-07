# Greenaway Worker — CLAUDE.md

Proceso **worker** (Node, aparte de la app Next.js) del marketplace de reservas. Corre el relay del
outbox, los consumers de BullMQ (emails, notificaciones in-app), el fan-out en tiempo real por Redis
pub/sub y el servidor socket.io del chat host↔guest. Proyecto de portfolio y de estudio: soluciones
simples que cubren el caso probable.

## Relación con la app (`greenaway`)

Los dos repos **no comparten código por import**: se hablan por la fila de outbox, los payloads JSON
de las colas y los eventos del socket. Los contratos compartidos se replican a mano y un cambio va a
los dos lados en el mismo cambio:

- **Fila de outbox:** la app la escribe (`OutboxEventType` en `greenaway/lib/outbox/types.ts`) y el
  relay de acá la lee. Los payloads de BullMQ (`src/events.ts`) viven solo acá.
- **Chat:** `src/chat/types.ts` ↔ `greenaway/lib/chat/socket.ts`.

**Antes de tocar colas o payloads, leer `docs/architecture/bullmq-queues.md`.**

## Stack

Node + TypeScript (ESM, `module: NodeNext`, `tsx` en dev) · BullMQ sobre Redis · socket.io +
`@socket.io/redis-adapter` · PostgreSQL (`pg`) · MongoDB (`mongodb`) · Resend.

## Comandos

> **Este repo usa `npm`, no `pnpm`.** Correr `pnpm` acá genera un lockfile paralelo.

```bash
npm run dev      # tsx watch src/index.ts
npm run build    # tsc -> dist/ (la verificación del repo: no hay lint ni tests)
npm start        # node dist/index.js
```

## Estructura

```
src/
  index.ts        Bootstrap: clients, listeners de error, relay, workers, shutdown.
  events.ts       Payloads de las colas + la unión de jobs de cada cola.
  relay.ts        Polling del outbox -> toJobs -> queue.add -> markAsPublished.
  outbox/         fan-out.ts: una fila de outbox -> sus jobs (por agregado y verbo).
  processors/     El índice de cada cola: switch de processorKey -> handler.
  emails/         Un archivo por mail (copy + template + handler) y send.ts (Resend).
  notifications/  Notificación in-app: documento en Mongo + publish al canal SSE.
  chat/           Tipos, validación y auth (handshake + membresía del room) del socket.
  redis/          Queues, workers, pub client y el server socket.io.
  pg/ · mongo/    Acceso a datos, un archivo por feature (users.pg.ts, chats.mongo.ts…).
  dates.ts · utils.ts   Formatters compartidos.
```

## Patrones

- **Capas:** `index` → `redis/` + `relay` → `processors/` + `chat/` → `emails/` + `notifications/` →
  `pg/` + `mongo/`. Cada capa solo conoce a la de abajo; los clients de infra no conocen dominio.
- **Repos:** un archivo por feature con sufijo de DB, una función por operación, prefijos
  `find`/`insert`/`update`/`delete`. Sin lógica de negocio: las decisiones van en el handler.
- **Processor = índice de la cola:** un `case` por `processorKey`; el `default` asigna a `never`, así
  que un job sin su `case` no compila. El trabajo vive en el archivo del evento.
- **Puro separado de I/O:** builders y templates puros (`buildNotification`, `toJobs`); el handler
  hace el I/O alrededor.
- **Copy por tipo con `Record<Type, …>`**, no cadenas de `if/else`. Formatters de `dates.ts`/`utils.ts`.
- **Persistir antes de emitir:** la DB es la fuente de verdad; el publish/emit es best-effort.
- **Errores:** un handler que no puede completar tira un `Error` y BullMQ reintenta; un error
  permanente (4xx de Resend) tira `UnrecoverableError`. Log con `[nombreDeLaFuncion]`, sin secretos.
- **Shutdown:** primero el relay (termina su tick), después los workers, las queues y el pub client.
- **Chat:** el handshake autentica (JWT); el join autoriza contra la reserva; el `sender_id` sale
  del servidor; se persiste antes de emitir y todo camino responde el ack.
- **Config por env**, clients singleton a nivel módulo. **Imports relativos con `.js`** (NodeNext).
- **Comentarios:** solo lo que no se deduce del código, máximo 2 líneas.

## Checklist al agregar código

- [ ] ¿Job nuevo? Seguir "Agregar un job" en `docs/architecture/bullmq-queues.md`.
- [ ] ¿Acceso a datos? En el archivo de esa feature, genérico y sin lógica de negocio.
- [ ] Persistir antes de emitir; handler que falla → `throw`.
- [ ] Imports relativos con `.js`.
- [ ] `npm run build` verde.

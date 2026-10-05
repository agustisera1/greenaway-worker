# TOOLING.md — Deuda de tooling del worker

Deuda del entorno de build/verificación, no del código de dominio. La deuda funcional de cada
feature vive scopeada aparte (la de chat, en
`greenaway/docs/tech_debt/CHAT_FEATURE_NEXT_STEPS.md`).

---

## 🟡 Sin linter

No hay ESLint configurado en este repo, a diferencia del producer. Los errores de estilo y los
imports sin usar solo se detectan a ojo. Poner la misma config del producer sería lo consistente.

## 🟡 Sin tests

Ninguna de las piezas puras (`buildNotification`, los templates) tiene tests,
aunque están escritas justamente para ser testeables sin levantar Redis/Mongo. Es el retorno más
barato disponible en este repo.

# AI Manager foundation

The first AI Manager layer deliberately separates verified calculations from generative AI.

## Deterministic first
`src/lib/performance.ts` remains the source for sales pace, projections, labor/parts percentages, ARO and TY/LY math. `src/lib/managerInsights.ts` ranks operational priorities from those verified outputs plus configured goals and custom KPIs.

The model must never recalculate accounting metrics or invent shop data.

## Priority logic
The engine can prioritize:
- sales pace below goal
- labor above configured goal
- parts above configured goal
- custom KPI gaps
- same-selling-day TY/LY decline
- positive sales pace protection

It returns only the top three priorities so the manager sees what matters today instead of a long report.

## Guardrails
- Future workload/open repair orders are unknown unless explicitly supplied later.
- Staffing advice uses conditional language.
- Sales impact from reducing labor is not assumed.
- KPI/company terminology comes from stored organization configuration.
- Future generative AI should explain and coach from deterministic context, not replace it.

## Next AI layer
A server-side AI endpoint can later receive a structured snapshot containing only RLS-authorized store/district data plus deterministic metrics and priorities. The API key must remain server-side. Feedback can be logged separately for usefulness without blindly training on user content.

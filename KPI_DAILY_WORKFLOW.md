# KPI Daily Workflow

This branch connects the Custom KPI Builder to the manager daily check-in.

- District Manager+ sees KPI Builder in app navigation.
- Assigned KPIs load automatically on the Numbers screen.
- Required KPIs are validated before save.
- KPI MTD values save to `kpi_month_values` with the authenticated user.
- Store Home shows KPI actual, goal, and on-target/needs-attention status.
- Existing RLS remains the source of authorization.

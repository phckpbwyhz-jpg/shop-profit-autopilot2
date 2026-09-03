create policy "profile_read_scoped_leadership"
on public.profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.user_assignments caller
    join public.user_assignments target
      on target.user_id = profiles.user_id
     and target.active = true
    where caller.user_id = (select auth.uid())
      and caller.active = true
      and caller.organization_id = target.organization_id
      and (
        caller.role in ('regional','owner','admin')
        or (
          caller.role = 'district_manager'
          and caller.district_id is not null
          and caller.district_id = target.district_id
        )
      )
  )
);

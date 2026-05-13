-- Fix infinite recursion in business_members SELECT policy
-- The old policy used accessible_business_ids() which queries business_members,
-- creating a circular dependency when evaluating RLS on business_members itself.

drop policy if exists "Members can view members of their businesses" on business_members;

create policy "Members can view members of their businesses"
  on business_members for select
  using (
    -- Owner can see all members of their businesses
    business_id in (select id from businesses where user_id = auth.uid()::text)
    -- Members can see their own membership records
    or user_id = auth.uid()::text
  );

-- De app toont logo's via de publieke URL van de bucket "logos" (/storage/v1/object/public/logos/...).
-- Dat werkt alleen als de bucket publiek is; voor een privé-bucket geeft Supabase "Bucket not found".
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set public = true where id = 'logos' and public is not true;
  end if;
end
$$;

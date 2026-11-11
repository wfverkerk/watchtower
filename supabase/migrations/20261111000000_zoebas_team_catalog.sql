create table if not exists public.zoebas_teams (
  id text primary key,
  name text not null check (length(name) between 1 and 60),
  source_team_id uuid not null unique,
  player_names text[] not null default '{}',
  sort_order integer not null
);

alter table public.zoebas_teams enable row level security;

drop policy if exists "Anyone can read the Zoebas team catalog" on public.zoebas_teams;
create policy "Anyone can read the Zoebas team catalog"
  on public.zoebas_teams for select to anon, authenticated
  using (true);

grant select on public.zoebas_teams to anon, authenticated;

insert into public.zoebas_teams (id, name, source_team_id, player_names, sort_order)
values
  ('mse-1', 'MSE-1', 'b5d589db-e873-4b8e-b954-8028ed1a6730', array['Jermain', 'Terrence', 'Jheran', 'Jair', 'Tetilia', 'Immanuel', 'Jayden'], 1),
  ('mse-2', 'MSE-2', 'b25e733a-dbc1-466d-ad90-c2638a327925', array['Hicham', 'Ranil', 'Sjors', 'Robin', 'Jordy', 'Mark', 'Ruben', 'Menno'], 2),
  ('mse-3', 'MSE-3', '19626ef3-fa8f-49eb-9ae1-7257ffcc046f', array['Yannick', 'Yuri', 'Jos', 'Patrick', 'Tim', 'Ezra', 'Richard', 'Joey', 'Michael', 'Stephan', 'Brend'], 3),
  ('vse-1', 'VSE-1', 'f89cf627-b9d4-4e89-98e4-7e1135535068', '{}', 4),
  ('vse-2', 'VSE-2', '39e655a5-9af4-408d-a4b7-3b705795e2b4', '{}', 5),
  ('m22-1', 'M22-1', '62c6e076-c09e-4e74-9ab2-7321590b2acb', array['Jeremy', 'Ryan', 'Wouter', 'Laurens', 'Sean', 'Dani', 'Justin', 'Sam', 'Nikan', 'Messi', 'Sam', 'Denver'], 6),
  ('m22-2', 'M22-2', 'e083e832-0a9a-477a-83e3-d92dc16319ba', array['Obdia', 'Tristen', 'Kris', 'Cas', 'Salvador', 'Owen', 'Milan', 'Colin', 'Quint', 'Finn'], 7),
  ('v22-1', 'V22-1', '2100b898-99bf-4c48-b90a-eaa966915ab1', array['Gemma', 'Julica', 'Yasmin', 'Isa', 'Iris', 'Vera', 'Daphne'], 8),
  ('m18-1', 'M18-1', '562dd440-3d50-4196-8893-7b065552cc1e', array['Demirhan', 'Dean', 'Djelano', 'Sam', 'Eldgie', 'Jens', 'Valentijn', 'Semii', 'Florian', 'D''andre', 'Luca'], 9),
  ('m18-2', 'M18-2', '98253a5a-6f23-4eca-9dd8-23136a08c564', array['Antoni', 'Maik', 'Jaivyn', 'Julian', 'Lasse', 'Noah', 'Menno', 'Ruben'], 10),
  ('v18-1', 'V18-1', 'c7660a71-b186-46ab-8db6-2f90edc4de8e', array['Joyceline', 'Senna', 'Jarah', 'Charlotte', 'Ilse', 'Eline', 'Isabel', 'Charissa'], 11),
  ('v18-2', 'V18-2', '8b50eb88-79bc-42b8-8b68-13fbb350ceb6', array['Dewi', 'Kyra', 'Maren', 'Naomi', 'Lola', 'Livia', 'Jula', 'Nena'], 12),
  ('m16-1', 'M16-1', '5a42d637-87c4-4df5-9cdb-fa97b5829ef3', array['Mats', 'Sam', 'Dean', 'Nathan', 'Denver', 'Mitchell', 'Tijl'], 13),
  ('m16-2', 'M16-2', '04067a6f-6b3a-45b5-a106-0879c2249280', array['Jussi', 'Quint', 'Parsa', 'Isaiah', 'Jesse', 'Jordan', 'Jacy', 'Stef', 'Cebrian', 'Zihao', 'Milan'], 14),
  ('m16-3', 'M16-3', '28b48777-51fe-422c-98a8-e624d5c653e8', array['Davin', 'Senna', 'Jaël', 'Tudor', 'Ede', 'Jelte', 'Abel', 'Victor', 'Lee'], 15),
  ('m16-4', 'M16-4', 'e0bc8ec9-dadd-4fdf-b55b-5be9707a7118', array['Maurits', 'Timo', 'Rohit', 'Liam', 'Adanto', 'Jaimy', 'Bektaş'], 16),
  ('v16-1', 'V16-1', 'e1855dd3-dfb9-4026-985d-5bda7947ab1e', array['Tebarek', 'Safia', 'Fenne', 'Fenna', 'Suryani', 'Noa', 'Lente'], 17),
  ('x14-1', 'X14-1', 'ad9365c1-b945-49f8-95e1-3b9ddcfc14c9', array['Myson', 'Phyllon', 'Logan', 'Ryan', 'Feda', 'Silvester', 'Marcus'], 18),
  ('x14-2', 'X14-2', '6a9961a8-6f5b-4656-b6a2-a5ecd3948dbd', array['Darren', 'Sam', 'Lieuwe', 'Lex', 'Tyler', 'Julius'], 19),
  ('v14-1', 'V14-1', '98015f0a-79f0-42e5-b028-ad7aa0ad3551', array['Lina', 'Noa', 'Sofía', 'Nora', 'Jelaysa', 'Meerle', 'Fenna', 'Jaya'], 20),
  ('x12-1', 'X12-1', '558bf1f5-735f-4b0c-8796-b49b997d3823', array['Marley', 'Stef', 'Mees', 'Maciej', 'Tim', 'Morris', 'Noud', 'Milan', 'Viggo'], 21),
  ('x12-2', 'X12-2', 'a0b1b911-3b19-4d6a-a610-0668b5be33af', array['MJ', 'Kian', 'Armin', 'Lorenzo', 'Shai', 'Thomas', 'Sem', 'Ümit'], 22),
  ('v12-1', 'V12-1', '48be1759-7275-484c-9efb-3a9e059152ac', array['Sofia', 'Fenna', 'Fleur', 'Jade', 'Veerle', 'Isa', 'Zoe', 'Julia', 'Nina', 'Kayla'], 23),
  ('x10-1', 'X10-1', '5c729e87-a0ce-419a-8fb5-4ab4f8e76650', array['Jaro', 'Fynn', 'Jort', 'Levi', 'Nick', 'Kasper', 'Luuk'], 24),
  ('x10-2', 'X10-2', 'b3bf03f8-0001-4bae-8d81-ec1c2aab0710', array['Quinten', 'Thiago', 'Senn', 'Kyan', 'Owen', 'Jaylison', 'Lex', 'Ekrem'], 25)
on conflict (id) do update set
  name = excluded.name,
  source_team_id = excluded.source_team_id,
  player_names = excluded.player_names,
  sort_order = excluded.sort_order;

-- Preserve the guard, signature, privileges and body; change only its error.
do $fix$
declare definition text;
begin
 definition := pg_get_functiondef('zg_private.assert_record_version(uuid,text,jsonb)'::regprocedure);
 if position('errcode=''40001''' in definition) = 0 then raise exception 'Expected conflict guard not found'; end if;
 execute replace(definition, 'errcode=''40001''', 'errcode=''PT409''');
end $fix$;

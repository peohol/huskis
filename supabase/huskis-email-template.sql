-- Huskis-profilert e-postmal for delingsinvitasjoner.
-- Kjøres etter users-and-sharing.sql og erstatter bare triggerfunksjonen.
-- Idempotent.

create or replace function public.send_invite_email()
returns trigger language plpgsql security definer
set search_path = public, extensions, net as $function$
declare
  api_key     text;
  from_addr   text;
  app_url     text;
  inviter     text;
  obj_name    text;
  inv_e       text;
  obj_e       text;
  subject     text;
  heading     text;
  explanation text;
  action_text text;
  body_html   text;
  body_text   text;
  link        text;
begin
  select value into api_key from public.app_config where key = 'resend_api_key';
  if api_key is null or api_key = '' then return new; end if;

  select value into from_addr from public.app_config where key = 'email_from';
  from_addr := coalesce(nullif(from_addr, ''), 'Huskis <onboarding@resend.dev>');

  select value into app_url from public.app_config where key = 'app_url';
  app_url := coalesce(nullif(app_url, ''), 'https://www.huskis.no/');

  select display_name into inviter from public.profiles where id = new.inviter_id;
  inviter := coalesce(inviter, 'Noen');
  obj_name := coalesce(
    (select name  from public.universes where id = new.universe_id),
    (select name  from public.groups    where id = new.group_id),
    (select title from public.cards     where id = new.card_id),
    'noe');

  inv_e := public.html_escape(inviter);
  obj_e := public.html_escape(obj_name);
  subject := inviter || ' har delt «' || obj_name || '» med deg på Huskis';

  if new.invitee_id is null then
    link := app_url || '?signup=' ||
      replace(replace(replace(new.invitee_email, '+', '%2B'), '@', '%40'), '&', '%26');
    heading := 'Du er invitert til Huskis';
    explanation := 'Opprett en konto med denne e-postadressen. Delingen dukker deretter opp i appen, slik at du kan godta den.';
    action_text := 'Opprett konto og bli med';
    body_text :=
      heading || E'\n\n' ||
      inviter || ' har delt «' || obj_name || '» med deg på Huskis.' || E'\n\n' ||
      explanation || E'\n\n' ||
      link || E'\n\n' ||
      'Huskis – huskis.no';
  else
    if (select coalesce(raw_user_meta_data ->> 'email_notifications', 'true')
          from auth.users where id = new.invitee_id) = 'false' then
      return new;
    end if;
    link := app_url;
    heading := obj_name || ' er delt med deg';
    explanation := 'Åpne Huskis for å se invitasjonen og velge hvor det delte innholdet skal plasseres.';
    action_text := 'Åpne Huskis';
    body_text :=
      heading || E'\n\n' ||
      inviter || ' har delt «' || obj_name || '» med deg på Huskis.' || E'\n\n' ||
      explanation || E'\n\n' ||
      link || E'\n\n' ||
      'Huskis – huskis.no';
  end if;

  body_html :=
    '<!DOCTYPE html>' ||
    '<html lang="no">' ||
    '<head>' ||
      '<meta charset="UTF-8">' ||
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">' ||
      '<meta http-equiv="X-UA-Compatible" content="IE=edge">' ||
      '<title>' || public.html_escape(subject) || '</title>' ||
    '</head>' ||
    '<body style="margin:0;padding:0;background-color:#667788;">' ||
      '<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#667788" style="width:100%;background-color:#667788;">' ||
        '<tr>' ||
          '<td align="center" style="padding-top:28px;padding-right:14px;padding-bottom:28px;padding-left:14px;">' ||
            '<table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#ffffff" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:18px;overflow:hidden;">' ||
              '<tr>' ||
                '<td bgcolor="#667788" style="background-color:#667788;padding-top:22px;padding-right:28px;padding-bottom:22px;padding-left:28px;">' ||
                  '<table cellpadding="0" cellspacing="0" border="0" role="presentation">' ||
                    '<tr>' ||
                      '<td width="22" height="22" bgcolor="#85ad85" style="width:22px;height:22px;background-color:#85ad85;border-radius:6px;font-size:1px;line-height:1px;color:#85ad85;">&nbsp;</td>' ||
                      '<td width="5" style="width:5px;font-size:1px;line-height:1px;">&nbsp;</td>' ||
                      '<td width="22" height="22" bgcolor="#adad85" style="width:22px;height:22px;background-color:#adad85;border-radius:6px;font-size:1px;line-height:1px;color:#adad85;">&nbsp;</td>' ||
                      '<td width="5" style="width:5px;font-size:1px;line-height:1px;">&nbsp;</td>' ||
                      '<td width="22" height="22" bgcolor="#ad8585" style="width:22px;height:22px;background-color:#ad8585;border-radius:6px;font-size:1px;line-height:1px;color:#ad8585;">&nbsp;</td>' ||
                      '<td width="14" style="width:14px;font-size:1px;line-height:1px;">&nbsp;</td>' ||
                      '<td style="font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:28px;font-weight:700;color:#ffffff;">Huskis</td>' ||
                    '</tr>' ||
                  '</table>' ||
                '</td>' ||
              '</tr>' ||
              '<tr>' ||
                '<td style="padding-top:36px;padding-right:34px;padding-bottom:12px;padding-left:34px;font-family:Arial,Helvetica,sans-serif;">' ||
                  '<p style="margin-top:0;margin-right:0;margin-bottom:10px;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;font-weight:700;letter-spacing:1.2px;color:#668866;">DELINGSINVITASJON</p>' ||
                  '<h1 style="margin-top:0;margin-right:0;margin-bottom:20px;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:27px;line-height:34px;font-weight:700;color:#1f272d;">' || public.html_escape(heading) || '</h1>' ||
                  '<p style="margin-top:0;margin-right:0;margin-bottom:22px;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:26px;color:#30383e;"><strong>' || inv_e || '</strong> har delt noe med deg:</p>' ||
                  '<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#f1f5f1" style="width:100%;background-color:#f1f5f1;border-left-width:5px;border-left-style:solid;border-left-color:#668866;border-radius:10px;">' ||
                    '<tr>' ||
                      '<td style="padding-top:17px;padding-right:20px;padding-bottom:17px;padding-left:20px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:25px;font-weight:700;color:#1f272d;">' || obj_e || '</td>' ||
                    '</tr>' ||
                  '</table>' ||
                  '<p style="margin-top:24px;margin-right:0;margin-bottom:24px;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;color:#30383e;">' || public.html_escape(explanation) || '</p>' ||
                  '<table cellpadding="0" cellspacing="0" border="0" role="presentation">' ||
                    '<tr>' ||
                      '<td bgcolor="#668866" style="background-color:#668866;border-radius:10px;">' ||
                        '<a href="' || public.html_escape(link) || '" style="display:inline-block;padding-top:13px;padding-right:22px;padding-bottom:13px;padding-left:22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;font-weight:700;color:#111111;text-decoration:none;border-radius:10px;">' || public.html_escape(action_text) || '</a>' ||
                      '</td>' ||
                    '</tr>' ||
                  '</table>' ||
                  '<p style="margin-top:24px;margin-right:0;margin-bottom:0;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#69747c;">Fungerer ikke knappen? Kopier denne adressen:<br><a href="' || public.html_escape(link) || '" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#4d664d;text-decoration:underline;word-break:break-all;">' || public.html_escape(link) || '</a></p>' ||
                '</td>' ||
              '</tr>' ||
              '<tr>' ||
                '<td style="padding-top:22px;padding-right:34px;padding-bottom:30px;padding-left:34px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#69747c;">' ||
                  'Denne automatiske meldingen ble sendt fordi noen delte innhold med deg i Huskis. Avsenderadressen kan ikke motta svar.' ||
                '</td>' ||
              '</tr>' ||
            '</table>' ||
          '</td>' ||
        '</tr>' ||
      '</table>' ||
    '</body>' ||
    '</html>';

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || api_key,
      'Content-Type',  'application/json'),
    body    := jsonb_build_object(
      'from',    from_addr,
      'to',      new.invitee_email,
      'subject', subject,
      'html',    body_html,
      'text',    body_text));

  return new;
exception when others then
  -- E-post er en bieffekt; feil skal ikke blokkere selve delingen.
  return new;
end;
$function$;

revoke all on function public.send_invite_email() from public, anon, authenticated;

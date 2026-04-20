WITH demo_registrars AS (
    SELECT id
    FROM registrars
    WHERE LOWER(name) IN (
        LOWER('Safaricom Kenya'),
        LOWER('HostAfrica EAC'),
        LOWER('HostPinnacle Cloud Limited'),
        LOWER('Kenya Website Experts'),
        LOWER('Truehost Cloud Limited')
    )
)
DELETE FROM registrars
WHERE id IN (SELECT id FROM demo_registrars);

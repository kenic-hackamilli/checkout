const DUPLICATE_CONFLICT_DEFINITIONS = [
  {
    fieldName: 'name',
    normalizedExpression: "LOWER(BTRIM(name))",
    valueExpression: 'name',
    whereClause: "name IS NOT NULL AND BTRIM(name) <> ''",
  },
  {
    fieldName: 'primary_email',
    normalizedExpression: "LOWER(BTRIM(primary_email))",
    valueExpression: 'primary_email',
    whereClause: "primary_email IS NOT NULL AND BTRIM(primary_email) <> ''",
  },
  {
    fieldName: 'notification_email',
    normalizedExpression: "LOWER(BTRIM(notification_email))",
    valueExpression: 'notification_email',
    whereClause:
      "notification_email IS NOT NULL AND BTRIM(notification_email) <> ''",
  },
  {
    fieldName: 'primary_phone',
    normalizedExpression: "regexp_replace(BTRIM(primary_phone), '[^0-9+]', '', 'g')",
    valueExpression: 'primary_phone',
    whereClause: "primary_phone IS NOT NULL AND BTRIM(primary_phone) <> ''",
  },
];

async function findRegistrarIdentityConflicts(client) {
  const conflicts = [];

  for (const definition of DUPLICATE_CONFLICT_DEFINITIONS) {
    const result = await client.query(
      `
        SELECT
          ${definition.normalizedExpression} AS normalized_value,
          COUNT(*)::int AS duplicate_count,
          json_agg(
            json_build_object(
              'id',
              id::text,
              'registrar_code',
              registrar_code,
              'name',
              name,
              'value',
              ${definition.valueExpression}
            )
            ORDER BY LOWER(name) ASC, created_at ASC, id ASC
          ) AS registrars
        FROM registrars
        WHERE ${definition.whereClause}
        GROUP BY ${definition.normalizedExpression}
        HAVING COUNT(*) > 1
        ORDER BY normalized_value ASC
      `
    );

    for (const row of result.rows) {
      conflicts.push({
        fieldName: definition.fieldName,
        normalizedValue: row.normalized_value,
        duplicateCount: row.duplicate_count,
        registrars: Array.isArray(row.registrars) ? row.registrars : [],
      });
    }
  }

  return conflicts;
}

function formatRegistrarIdentityConflicts(conflicts = []) {
  if (!Array.isArray(conflicts) || conflicts.length === 0) {
    return 'No registrar identity conflicts found.';
  }

  return conflicts
    .map((conflict) => {
      const header = `${conflict.fieldName}: "${conflict.normalizedValue}" (${conflict.duplicateCount} registrars)`;
      const registrarLines = Array.isArray(conflict.registrars)
        ? conflict.registrars.map((registrar) => {
            const code = registrar.registrar_code ? ` ${registrar.registrar_code}` : '';
            return `  - ${registrar.name}${code} [${registrar.id}] value=${registrar.value}`;
          })
        : [];

      return [header, ...registrarLines].join('\n');
    })
    .join('\n\n');
}

module.exports = {
  findRegistrarIdentityConflicts,
  formatRegistrarIdentityConflicts,
};

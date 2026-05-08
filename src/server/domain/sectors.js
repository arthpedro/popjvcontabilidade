function slugifySectorName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSector(sector) {
  const name = String(sector?.name || sector?.nome || "").trim().replace(/\s+/g, " ");
  const id = slugifySectorName(sector?.id || name);

  if (!id || !name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    return null;
  }

  return { id, name };
}

function normalizeSectorsList(sectorList) {
  const uniqueSectors = new Map();

  for (const sector of sectorList) {
    const normalized = normalizeSector(sector);

    if (normalized && !uniqueSectors.has(normalized.id)) {
      uniqueSectors.set(normalized.id, normalized);
    }
  }

  return Array.from(uniqueSectors.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function publicSector(sector) {
  return {
    id: sector.id,
    name: sector.name,
    nome: sector.name
  };
}

function getSectorNameFromId(sectorId) {
  return String(sectorId || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

module.exports = {
  getSectorNameFromId,
  normalizeSector,
  normalizeSectorsList,
  publicSector,
  slugifySectorName
};

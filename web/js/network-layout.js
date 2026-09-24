const WIDTH = 1000;
const HEIGHT = 680;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const BOUNDS = { left: 72, right: WIDTH - 72, top: 62, bottom: HEIGHT - 62 };

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function connectedComponents(usernames, adjacency) {
  const remaining = new Set(usernames);
  const components = [];
  while (remaining.size) {
    const first = remaining.values().next().value;
    const pending = [first];
    const component = [];
    remaining.delete(first);
    while (pending.length) {
      const current = pending.pop();
      component.push(current);
      for (const neighbor of adjacency.get(current) || []) {
        if (remaining.delete(neighbor)) pending.push(neighbor);
      }
    }
    components.push(component);
  }
  return components.sort((a, b) => b.length - a.length);
}

function componentTargets(components) {
  const targets = new Map();
  const largest = components[0] || [];
  for (const username of largest) targets.set(username, { x: CENTER_X, y: CENTER_Y });

  const others = components.slice(1);
  if (!others.length) return targets;
  const radiusX = 315;
  const radiusY = 220;
  others.forEach((component, index) => {
    const angle = (index / Math.max(others.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const target = {
      x: CENTER_X + Math.cos(angle) * radiusX,
      y: CENTER_Y + Math.sin(angle) * radiusY,
    };
    for (const username of component) targets.set(username, target);
  });
  return targets;
}

function recenterComponent(component, positions, target) {
  if (!component.length) return;
  const center = component.reduce(
    (sum, username) => ({
      x: sum.x + positions.get(username).x,
      y: sum.y + positions.get(username).y,
    }),
    { x: 0, y: 0 },
  );
  center.x /= component.length;
  center.y /= component.length;
  for (const username of component) {
    positions.set(username, {
      x: positions.get(username).x - center.x + target.x,
      y: positions.get(username).y - center.y + target.y,
    });
  }
}

/**
 * Deterministic force-like layout. Edge attraction scales with connection count
 * and weight, so hubs settle closer together and denser components stay compact.
 */
export function layoutSecondaryNetwork(edges) {
  const usernames = new Set();
  const adjacency = new Map();
  const degree = new Map();
  const incident = new Map();

  for (const username of usernames) adjacency.set(username, new Set());
  for (const edge of edges) {
    usernames.add(edge.source);
    usernames.add(edge.target);
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
    if (!incident.has(edge.source)) incident.set(edge.source, []);
    if (!incident.has(edge.target)) incident.set(edge.target, []);
    incident.get(edge.source).push(edge);
    incident.get(edge.target).push(edge);
  }
  for (const username of usernames) {
    adjacency.set(username, adjacency.get(username) || new Set());
    degree.set(username, degree.get(username) || 0);
  }

  if (!usernames.size) return new Map();
  if (usernames.size === 1) {
    return new Map([[usernames.values().next().value, { x: CENTER_X, y: CENTER_Y }]]);
  }

  const components = connectedComponents(usernames, adjacency);
  const targets = componentTargets(components);
  const positions = new Map();
  const maxDegree = Math.max(...degree.values(), 1);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (const component of components) {
    const ordered = [...component].sort(
      (a, b) => degree.get(b) - degree.get(a) || a.localeCompare(b, "es"),
    );
    ordered.forEach((username, index) => {
      const localDegree = degree.get(username) || 1;
      const angle = index * goldenAngle - Math.PI / 2;
      const radius = 45 + 135 * Math.sqrt(index / Math.max(ordered.length - 1, 1));
      const target = targets.get(username);
      positions.set(username, {
        x: target.x + Math.cos(angle) * radius,
        y: target.y + Math.sin(angle) * radius * 0.78 - (1 - localDegree / maxDegree) * 20,
      });
    });
  }

  const names = [...usernames];
  for (let iteration = 0; iteration < 150; iteration += 1) {
    const next = new Map();
    for (const username of names) {
      const position = positions.get(username);
      const links = incident.get(username) || [];
      let attractionX = 0;
      let attractionY = 0;
      let totalWeight = 0;
      for (const edge of links) {
        const neighbor = edge.source === username ? edge.target : edge.source;
        const neighborPosition = positions.get(neighbor);
        if (!neighborPosition) continue;
        const weight = Number(edge.weight) || 1;
        attractionX += neighborPosition.x * weight;
        attractionY += neighborPosition.y * weight;
        totalWeight += weight;
      }
      if (totalWeight) {
        attractionX = attractionX / totalWeight - position.x;
        attractionY = attractionY / totalWeight - position.y;
      }

      const degreeRatio = Math.sqrt((degree.get(username) || 0) / maxDegree);
      const targetRadius = 275 - degreeRatio * 165;
      const target = targets.get(username) || { x: CENTER_X, y: CENTER_Y };
      const centerPullX = (target.x - position.x) * 0.012;
      const centerPullY = (target.y - position.y) * 0.012;
      const radialScale = targetRadius / Math.max(Math.hypot(position.x - target.x, position.y - target.y), 1);
      const radialX = (target.x + (position.x - target.x) * radialScale - position.x) * 0.016;
      const radialY = (target.y + (position.y - target.y) * radialScale - position.y) * 0.016;

      next.set(username, {
        x: position.x + attractionX * 0.035 + centerPullX + radialX,
        y: position.y + attractionY * 0.035 + centerPullY + radialY,
      });
    }

    for (let left = 0; left < names.length; left += 1) {
      for (let right = left + 1; right < names.length; right += 1) {
        const a = names[left];
        const b = names[right];
        const pa = next.get(a);
        const pb = next.get(b);
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const distanceSquared = Math.max(dx * dx + dy * dy, 36);
        const distance = Math.sqrt(distanceSquared);
        const repulsion = Math.min(4.5, 72 / distanceSquared);
        const forceX = (dx / distance) * repulsion;
        const forceY = (dy / distance) * repulsion;
        pa.x -= forceX;
        pa.y -= forceY;
        pb.x += forceX;
        pb.y += forceY;
      }
    }

    for (const username of names) {
      const position = next.get(username);
      position.x = clamp(position.x, BOUNDS.left, BOUNDS.right);
      position.y = clamp(position.y, BOUNDS.top, BOUNDS.bottom);
    }
    positions.clear();
    for (const [username, position] of next) positions.set(username, position);
  }

  for (const component of components) recenterComponent(component, positions, targets.get(component[0]));
  for (const username of names) {
    const position = positions.get(username);
    position.x = clamp(position.x, BOUNDS.left, BOUNDS.right);
    position.y = clamp(position.y, BOUNDS.top, BOUNDS.bottom);
  }
  return positions;
}

export function layoutContextNetwork(items) {
  const ordered = [...items].sort(
    (a, b) => b.weight - a.weight || a.name.localeCompare(b.name, "es"),
  );
  const positions = new Map();
  const maxWeight = Math.max(...ordered.map((item) => Number(item.weight) || 1), 1);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  ordered.forEach((item, index) => {
    const degreeRatio = Math.sqrt((Number(item.weight) || 1) / maxWeight);
    const radius = 285 - degreeRatio * 165;
    const angle = index * goldenAngle - Math.PI / 2;
    positions.set(item.id, {
      x: CENTER_X + Math.cos(angle) * radius,
      y: CENTER_Y + Math.sin(angle) * radius,
    });
  });
  return positions;
}

export function layoutEgoNetwork(count) {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, index) => {
    const ratio = (index + 0.65) / Math.max(count, 1);
    const radius = 124 + 178 * Math.sqrt(ratio);
    const angle = index * goldenAngle - Math.PI / 2;
    return { x: CENTER_X + Math.cos(angle) * radius, y: CENTER_Y + Math.sin(angle) * radius };
  });
}

const { emit, makePlugin, worldGen, chunks, patches } = require("./bullet");

const plugin = makePlugin("explorables");
const storage = plugin.getStorage();

const blueprints = {};

if (!storage.explorables)
{
  storage.explorables = [];
}
if (!storage.unused)
{
  storage.unused = [];
}

// TODO: Base off world gen border
const worldEdge = 5000000;
worldGen.patchGenerator("edgeDist - Math.abs(y) < 1)", "edgeDist-Math.abs(y)<1){bottomtile='&#8193'}else if(edgeDist-Math.abs(y)>-1000)");
patches.addPatch("YOU.getCoordString",
  `return (YOU.x > 0 ? "+" : "") + YOU.x + ", " + (YOU.y > 0 ? "+" : "") + YOU.y;`,
  `if(YOU.y>=5000000){return "- -";}else{return (YOU.x > 0 ? "+" : "") + YOU.x + ", " + (YOU.y > 0 ? "+" : "") + YOU.y;}`,
  false
);

async function generateExplorable(structure, blueprint)
{
  // Get id from packed array
  let explorableId;
  if (storage.unused.length === 0)
  {
    explorableId = storage.explorables.length;
  }
  else
  {
    explorableId = storage.unused.pop();
  }

  // Create explorable
  const explorable = {
    type: blueprint.type,
    x: explorableId % 1000,
    y: Math.floor(explorableId / 1000),
    entranceX: 0,
    entranceY: 0,
    exitToX: structure.public.x,
    exitToY: structure.public.y
  };

  // Place blueprint
  // Blueprint could be a generator function
  if (typeof blueprint === "function")
  {
    blueprint = blueprint();
  }
  const worldPositionX = (-worldEdge + (200 * explorable.x));
  const worldPositionY = (worldEdge + (200 * explorable.y));
  const chunkCoords = chunks.toChunkCoords(worldPositionX, worldPositionY);

  if (!chunks.isChunkCoordsLoaded(chunkCoords.x, chunkCoords.y))
  {
    await chunks.loadChunk(chunkCoords.x, chunkCoords.y);
  }

  const chunk = chunks.getChunkFromChunkCoords(chunkCoords.x, chunkCoords.y);

  for (let x = worldPositionX; x < worldPositionX + blueprint.width + 2; ++x)
  {
    for (let y = worldPositionY; y < worldPositionY + blueprint.height + 2; ++y)
    {
      if (x === worldPositionX || x === worldPositionX + blueprint.width + 1
       || y === worldPositionY || y === worldPositionY + blueprint.height + 1)
      {
        chunk[x + "|" + y] = [{public:{},private:{structureId:"barrier"}}];
      }
    }
  }

  blueprint.layout.forEach((palleteIndex, index) => {
    if (palleteIndex < 0) return;
    const x = 1 + worldPositionX + (index % blueprint.width);
    const y = worldPositionY + (blueprint.height - Math.floor(index / blueprint.width));
    const structureId = blueprint.pallete[palleteIndex];
    if (structureId === "exit")
    {
      explorable.entranceX = x;
      explorable.entranceY = y;
      chunk[x + '|' + y] = [{
        public: {},
        private:{
          structureId: blueprint.pallete[palleteIndex],
          explorableId
        }
      }];
      return;
    }
    chunk[x + '|' + y] = [{
      public: {},
      private:{
        structureId: blueprint.pallete[palleteIndex]
      }
    }];
  });

  // Save
  storage.explorables[explorableId] = explorable;
  plugin.setStorage(storage);

  chunks.unLoadChunk(chunkCoords.x, chunkCoords.y);

  return explorableId;
}

async function deleteExplorable(structure)
{
  const { explorableId } = structure.private;
  const explorable = storage.explorables[explorableId];
  console.log(explorable);
  if (!explorable)return;
  storage.explorables[explorableId] = null;
  storage.unused.push(explorableId);
  const worldPositionX = (-worldEdge + (200 * explorable.x));
  const worldPositionY = (worldEdge + (200 * explorable.y));
  const chunkCoords = chunks.toChunkCoords(worldPositionX, worldPositionY);

  if (!chunks.isChunkCoordsLoaded(chunkCoords.x, chunkCoords.y))
  {
    await chunks.loadChunk(chunkCoords.x, chunkCoords.y);
  }
  const chunk = chunks.getChunkFromChunkCoords(chunkCoords.x, chunkCoords.y);
  const blueprint = blueprints[explorable.type];

  for (let x = worldPositionX; x < worldPositionX + blueprint.width + 2; ++x)
  {
    for (let y = worldPositionY; y < worldPositionY + blueprint.height + 2; ++y)
    {
      chunk[x + "|" + y] = undefined;
    }
  }

  // save
  plugin.setStorage(storage);
}


plugin.on("explorables::load", (structureId, blueprint) => {
  if (!structureId || !blueprint)
  {
    console.error("explorables::load requires a 'structure' and 'blueprint'");
    return;
  }

  blueprints[blueprint.type] = blueprint;

  plugin.on(`travelers::structurePlaced::${structureId}`, (structure) => {
    generateExplorable(structure, blueprint)
    .then((id) => structure.private.explorableId = id);
  }, 0);

  plugin.on(`travelers::structureBroke::${structureId}`, (structure) => {
    deleteExplorable(structure);
  }, 0);
}, 0);


plugin.on("travelers::onPlayerStep", async (player, cancel) => {
  if (player.cache.travelData.dir === "")
    return;

  const obj = chunks.getObject(player.public.x, player.public.y);
  if (!obj)return;

  const explorableId = obj.private.explorableId;
  if (explorableId !== undefined)
  {
    const targetLoc = {x:0,y:0};
    if (obj.private.structureId === "exit")
    {
      targetLoc.x = storage.explorables[explorableId].exitToX;
      targetLoc.y = storage.explorables[explorableId].exitToY;
      player.private.explorableId = undefined;
    }
    else
    {
      targetLoc.x = storage.explorables[explorableId].entranceX;
      targetLoc.y = storage.explorables[explorableId].entranceY;
      player.private.explorableId = explorableId;
    }

    const chunkTarget = chunks.toChunkCoords(targetLoc.x, targetLoc.y);
    if (!chunks.isChunkCoordsLoaded(chunkTarget.x, chunkTarget.y))
    {
      await chunks.loadChunk(chunkTarget.x, chunkTarget.y);
    }
    player.public.x = targetLoc.x;
    player.public.y = targetLoc.y;

    if(player.public.state === 'travel')
    {
      emit('travelers', 'stopPlayerMovement', player);
    }
    player.addPropToQueue("x", "y");
    cancel.set(true);
  }
});


// Disable teleporters inside explorables
function disable(player) {
  const { explorableId } = player.private;
  if (typeof explorableId === "number") return false;
}
plugin.on('equip_actions::high_teleporter::north', disable, 10);
	plugin.on('equip_actions::high_teleporter::east', disable, 10);
	plugin.on('equip_actions::high_teleporter::south', disable, 10);
	plugin.on('equip_actions::high_teleporter::west', disable, 10);
	// low teleporter
	plugin.on('equip_actions::low_teleporter::north', disable, 10);
	plugin.on('equip_actions::low_teleporter::east', disable, 10);
	plugin.on('equip_actions::low_teleporter::south', disable, 10);
	plugin.on('equip_actions::low_teleporter::west', disable, 10);


plugin.on("ready", () => {
  // Structures
  emit("travelers", "addStructureData", {
    id: "exit",
    placingItem: "exit",
    char: "X"
  });
  
  emit("travelers", "addStructureData", {
    id: "barrier",
    placingItem: "barrier",
    char: "&nbsp",
    walkOver: false
  });
})

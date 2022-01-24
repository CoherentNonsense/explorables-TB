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

  const xPosition = explorableId % 1000;
  const yPosition = Math.floor(explorableId / 1000);
  const worldPositionX = (-worldEdge + (200 * xPosition));
  const worldPositionY = (worldEdge + (200 * yPosition));

  // Place blueprint
  // Blueprint could be a generator function
  if (typeof blueprint.generate === "function")
  {
    blueprint = {
      ...blueprint,
      ...blueprint.generate(worldPositionX, worldPositionY),
    };
  }

  // Create explorable
  const explorable = {
    type: blueprint.type,
    x: xPosition,
    y: yPosition,
    entranceX: 0,
    entranceY: 0,
    exitToX: structure.public.x,
    exitToY: structure.public.y,
    playerCount: 0,
  };
  
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

async function deleteExplorable(explorableId)
{
  const explorable = storage.explorables[explorableId];
  if (!explorable)return;
  const worldPositionX = (-worldEdge + (200 * explorable.x));
  const worldPositionY = (worldEdge + (200 * explorable.y));
  const chunkCoords = chunks.toChunkCoords(worldPositionX, worldPositionY);

  if (!chunks.isChunkCoordsLoaded(chunkCoords.x, chunkCoords.y))
  {
    await chunks.loadChunk(chunkCoords.x, chunkCoords.y);
  }
  const chunk = chunks.getChunkFromChunkCoords(chunkCoords.x, chunkCoords.y);
  for (let x = worldPositionX; x < worldPositionX + 100; ++x)
  {
    for (let y = worldPositionY; y < worldPositionY + 100; ++y)
    {
      chunk[x + "|" + y] = undefined;
    }
  }

  // save
  storage.explorables[explorableId] = null;
  storage.unused.push(explorableId);
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
    deleteExplorable(structure.private.explorableId);
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
    let explorable = storage.explorables[explorableId];
    const blueprint = blueprints[explorable.type];
    if (obj.private.structureId === "exit")
    {
      targetLoc.x = explorable.exitToX;
      targetLoc.y = explorable.exitToY;
      player.private.explorableId = undefined;
      --explorable.playerCount;
      if (explorable.playerCount < 0)
      {
        explorable.playerCount = 0;
      }
      emit("explorables", "exiting", explorable);
    }
    else
    {
      if (blueprint.resetTimer && !explorable.resetAt)
      {
        explorable.resetAt = Date.now() + blueprint.resetTimer;
      }

      if (explorable.playerCount === 0
        && blueprint.resetTimer
        && explorable.resetAt > Date.now()
      ) {
        explorable.resetAt = Date.now() + blueprint.resetTimer;
        obj.private.explorableId = await generateExplorable(obj, blueprint);
        explorable = storage.explorables[obj.private.explorableId];
        deleteExplorable(explorableId);
      }
      targetLoc.x = explorable.entranceX;
      targetLoc.y = explorable.entranceY;
      player.private.explorableId = obj.private.explorableId;
      emit("explorables", "entering", explorable);
      ++explorable.playerCount;
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

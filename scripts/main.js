const lg = x => console.log(x);

const moduleID = 'spellpoints-pf2e';

const maxSPdefault = {};
for (let i = 1; i < 31; i++) {
    maxSPdefault[i] = i;
}

const useSPdefault = {};
for (let i = 0; i < 11; i++) {
    useSPdefault[i] = i;
}


Hooks.once('init', () => {
    // CONFIG.PF2E.spellCategories.spellPoints = 'Spell Points';
    CONFIG.PF2E.preparationType.spellPoints = 'Spell Points';

    game.settings.register(moduleID, 'maxSP', {
        scope: 'world',
        type: Object,
        default: maxSPdefault,
        requiresReload: true
    });

    game.settings.registerMenu(moduleID, 'maxSPMenu', {
        name: 'Max Spell Points Per Character Level',
        label: 'Configure',
        type: ConfigureMaxSP,
        restricted: true
    });

    game.settings.register(moduleID, 'useSP', {
        scope: 'world',
        type: Object,
        default: useSPdefault
    });

    game.settings.registerMenu(moduleID, 'useSPMenu', {
        name: 'Spell Points Used Per Spell Level',
        label: 'Configure',
        type: ConfigureSPuse,
        restricted: true
    });

    libWrapper.register(moduleID, 'CONFIG.Token.documentClass.prototype.getBarAttribute', getSpellPointBar, 'WRAPPER');
    libWrapper.register(moduleID, 'CONFIG.PF2E.Item.documentClasses.spellcastingEntry.prototype.cast', consumeSpellPoints, 'MIXED');
    libWrapper.register(moduleID, 'CONFIG.PF2E.Actor.documentClasses.character.prototype.prepareDerivedData', addSpellPointsAttribute, 'WRAPPER');

});


Hooks.on('renderCharacterSheetPF2e', (app, [html], appData) => {
    const { actor } = app;
    const { level } = actor;
    const maxSP = actor.system.attributes.spellPoints.max;

    html.querySelectorAll('li.spellcasting-entry').forEach(li => {
        const item = actor.items.get(li.dataset.itemId);
        if (!item || item?.system.prepared.value !== 'spellPoints') return;

        const spellPoints = document.createElement('div');
        spellPoints.classList.add('skill-data');
        spellPoints.innerHTML = `
            <h4 class="skill-name">Spell Points</h4>
            <input class="spell-points" type="number" value="${actor.system.attributes.spellPoints?.value || 0}" placeholder="0">
            <span>/</span>
            <input class="spell-points" type="number" value="${maxSP}" disabled>
        `;
        spellPoints.querySelector('input').addEventListener('focus', ev => {
            ev.currentTarget.select();
        });
        spellPoints.querySelector('input').addEventListener('change', ev => {
            const { target } = ev;
            const newSP = target.value;
            const clampedSP = Math.clamped(newSP, 0, maxSP);
            target.value = clampedSP;

            actor.update({ 'system.attributes.spellPoints.value': clampedSP });
        });    

        li.querySelector('div.statistic-values').appendChild(spellPoints);
    });

});

Hooks.on('dropActorSheetData', async (actor, actorSheet, dropData) => {
    let item = fromUuidSync(dropData.uuid);
    if (item?.pack) item = await game.packs.get(item.pack)?.getDocument(item._id);
    if (item?.type !== 'spell') return;

    Hooks.once('preCreateItem', (item, createData, options, userID) => {
        item.updateSource({ 'system.category.value': 'spellPoints' });
    });
});

Hooks.on('updateActor', (actor, diff, options, userID) => {
    if (game.user.id !== userID) return;
    if (actor.type !== 'character' || !foundry.utils.hasProperty(diff, 'system.details.level')) return;
    
    const newCharacterLevel = diff.system.details.level.value;
    //const currentSP = actor.system.attributes.spellPoints.value;
    const maxSP = (actor.system.attributes.spellPoints?.max ?? actor.class.getFlag(moduleID, 'spellPointProgression')?.[newCharacterLevel]) || game.settings.get(moduleID, 'maxSP')[newCharacterLevel];

    return actor.update({ 'system.attributes.spellPoints.value': maxSP });
});

Hooks.on('renderClassSheetPF2e', (app, [html], appData) => {
    const spellPointsDiv = document.createElement('div');
    spellPointsDiv.classList.add('form-group', 'form-group-trait');

    const spellPointsLabel = document.createElement('label');
    spellPointsLabel.innerText = 'Spell Points ';
    const spellPointsA = document.createElement('a');
    spellPointsA.classList.add('tag-selector');
    spellPointsA.innerHTML = `<i class="fas fa-edit"></i>`;
    spellPointsA.addEventListener('click', () => {
        new ConfigureMaxSPClass(app.object).render(true);
    });
    spellPointsLabel.appendChild(spellPointsA);
    spellPointsDiv.appendChild(spellPointsLabel);

    const spellPointsUl = document.createElement('ul');
    spellPointsUl.classList.add('abc-traits-list')
    const spellPointsData = app.object.getFlag(moduleID, 'spellPointProgression') || game.settings.get(moduleID, 'maxSP');
    for (const [level, spellPoints] of Object.entries(spellPointsData)) {
        const levelSpan = document.createElement('span');
        levelSpan.classList.add('tag-legacy', level);
        levelSpan.innerText = `Level ${level}: ${spellPoints}`;
        spellPointsUl.appendChild(levelSpan);
    }
    spellPointsDiv.appendChild(spellPointsUl);

    const dataTraitsLabel = html.querySelector('label[for="data.traits"]');
    const dataTraitsDiv = dataTraitsLabel.parentElement;
    dataTraitsDiv.before(spellPointsDiv);
});

Hooks.on('pf2e.restForTheNight', async actor => {
    if (!actor.isOwner) return;
    if (!actor.system.attributes.spellPoints) return;
    
    await actor.update({ 'system.attributes.spellPoints.value': actor.system.attributes.spellPoints.max });
});


function getSpellPointBar(wrapper, barName, alternative) {
    const res = wrapper(barName, alternative);
    if (res?.attribute === 'attributes.spellPoints') res.editable = true;

    return res;
}

async function consumeSpellPoints(wrapper, spell, options = {}) {
    const isSpellPoints = spell.system.category.value === 'spellPoints';

    if (isSpellPoints) {
        const { actor, level } = spell;
        const currentSP = actor.system.attributes.spellPoints?.value ?? null;
        const spUse = game.settings.get(moduleID, 'useSP')[level];
        if (spUse > currentSP) return ui.notifications.warn('Not enough Spell Points to cast!');

        await actor.update({ 'system.attributes.spellPoints.value': currentSP - spUse });
        return spell.toMessage(undefined, { data: { spellLvl: level } });

    } else return wrapper(spell, options);
}

function addSpellPointsAttribute(wrapper) {
    wrapper();

    const currentSP = this.system.attributes.spellPoints?.value;
    const characterClass = this.class;
    const spFlagData = characterClass?.getFlag(moduleID, 'spellPointProgression');
    let maxSP = spFlagData?.[this.level] ?? game.settings.get(moduleID, 'maxSP')[this.level] ?? 0;
    for (const rule of this.rules) {
        if (rule.path !== 'system.attributes.spellPoints.max') continue;

        maxSP += rule.value;
    }
    this.system.attributes.spellPoints = {
        value: Math.clamped(currentSP ?? maxSP, 0, maxSP),
        max: maxSP
    }
}


class ConfigureMenu extends FormApplication {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: [moduleID],
            width: 250
        });
    }

    get template() {
        return `modules/${moduleID}/templates/config.hbs`;
    }

    getData() {
        const data = {};
        data.headers = this.headers;
        const settingsData = game.settings.get(moduleID, this.settingsKey);
        data.sp = settingsData;

        return data;
    }

    activateListeners($html) {
        super.activateListeners($html);
        
        const [html] = $html;

        html.querySelector('button[name="reset"]').addEventListener('click', () => {
            html.querySelectorAll('input').forEach(i => {
                i.value = parseInt(i.name);
            });
        });
    }

    async _updateObject(event, formData) {
        const data = {};
        for (const [k, v] of Object.entries(formData)) {
            const n = parseInt(k.split('-')[1]);
            data[n] = v || n;
        }
        return game.settings.set(moduleID, this.settingsKey, data);
    }

}

class ConfigureMaxSP extends ConfigureMenu {
    constructor() {
        super();

        this.settingsKey = 'maxSP';
        this.headers = ['Character Level', 'Max Spell Points'];
    }

    get title() {
        return 'Configure Max Spell Points';
    }
}

class ConfigureMaxSPClass extends ConfigureMaxSP {
    constructor(classItem) {
        super();

        this.class = classItem;
        this.className = classItem.name;
        this.spProgression = classItem.getFlag(moduleID, 'spellPointProgression');
    }

    get title() {
        return `SP Progression: ${this.className}`;
    }

    getData() {
        const data = super.getData();
        if (!this.spProgression) return data;
        
        data.sp = this.spProgression;

        return data;
    }

    async _updateObject(event, formData) {
        const data = {};
        for (const [k, v] of Object.entries(formData)) {
            const n = parseInt(k.split('-')[1]);
            data[n] = v || n;
        }
        return this.class.setFlag(moduleID, 'spellPointProgression', data); 
    }
}

class ConfigureSPuse extends ConfigureMenu {
    constructor() {
        super();

        this.settingsKey = 'useSP';
        this.headers = ['Spell Level', 'Spell Points Used'];
    }

    get title() {
        return 'Configure Spell Point Use';
    }

}

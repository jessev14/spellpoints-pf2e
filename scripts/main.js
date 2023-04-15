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
    CONFIG.PF2E.spellCategories.spellPoints = 'Spell Points';
    CONFIG.PF2E.preparationType.spellPoints = 'Spell Points';

    game.settings.register(moduleID, 'maxSP', {
        scope: 'world',
        type: Object,
        default: maxSPdefault
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
    const maxSP = game.settings.get(moduleID, 'maxSP')[level];

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

            actor.update({ 'data.attributes.spellPoints.value': clampedSP });
        });    

        li.querySelector('div.statistic-values').appendChild(spellPoints);
    });

});

Hooks.on('dropActorSheetData', async (actor, actorSheet, dropData) => {
    if (dropData.type !== 'Item') return;
    
    let item;
    if (dropData.pack) {
        const compendium = game.packs.get(dropData.pack);
        item = await compendium.getDocument(dropData.id);
    } else item = game.items.get(dropData.id);
    if (item?.type !== 'spell') return;

    Hooks.once('preCreateItem', (item, createData, options, userID) => {
        item.data.update({ 'data.category.value': 'spellPoints' });
    });
});

Hooks.on('preUpdateActor', (actor, diff, options, userID) => {
    if (actor.type !== 'character' || !foundry.utils.hasProperty(diff, 'data.details.level')) return;
    
    const newCharacterLevel = diff.data.details.level.value;
    const currentSP = actor.system.attributes.spellPoints.value;
    const maxSP = game.settings.get(moduleID, 'maxSP')[newCharacterLevel];

    if (currentSP > maxSP) actor.data.update({ 'data.attributes.spellPoints.value': maxSP });
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

        await actor.update({ 'data.attributes.spellPoints.value': currentSP - spUse });
        return spell.toMessage(undefined, { data: { spellLvl: level } });

    } else return wrapper(spell, options);
}

function addSpellPointsAttribute(wrapper) {
    wrapper();

    const currentSP = this.system.attributes.spellPoints?.value;
    const maxSP = game.settings.get(moduleID, 'maxSP')[this.level] ?? 0;
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
        data.sp = [];
        for (let i = this.settingsKey === 'maxSP' ? 1 : 0; i < (this.settingsKey === 'maxSP' ? 31 : 11); i++) {
            data.sp.push([i, (settingsData[i] === i ? '' : settingsData[i])]);
        }

        return data;
    }

    activateListeners(html) {
        super.activateListeners(html);

        html[0].querySelector('button[name="reset"]').addEventListener('click', () => {
            html[0].querySelectorAll('input').forEach(i => {
                i.value = i.name;
            });
        });
    }

    async _updateObject(event, formData) {
        const data = {};
        for (const [k, v] of Object.entries(formData)) {
            data[k] = v || parseInt(k);
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

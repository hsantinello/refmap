import { useState, useEffect, useRef } from 'react'
import { usePromptStore, useCanvasStore } from '../../store'
import { useMyPresets } from '../../hooks/useMyPresets'

const PRESETS: { group: string; items: string[] }[] = [
  {
    group: 'Angle of View',
    items: ['Atmospheric Perspective','Blurry Foreground','Close-Up','Cowboy Shot','Cut-In','Dutch Angle','First-Person View','Fisheye','From Above','From Behind','From Below','From Outside','From Side','Hatching (Texture)','Multiple Views','Panorama','Perspective','Pov','Rotated','Sideways','Three Sided View','Upside-Down','Vanishing Point','Wide Shot'],
  },
  {
    group: 'Artists',
    items: ['Abanindranath Tagore','Abdur Rahman Chughtai','Adolf Wölfli','Agnes Martin','Ai Weiwei','Albert Bierstadt','Albert Gleizes','Alberto Giacometti','Albrecht Dürer','Alexander Calder','Alexander Rodchenko','Alfred Wallis','Alice Neel','Alphonse Mucha','Amedeo Modigliani','André Derain','Andrei Rublev','Andy Goldsworthy','Andy Warhol','Angelica Kauffman','Ansel Adams','Anselm Kiefer','Anthony Van Dyck','Antoni Gaudi','Antonio Canova','Aubrey Beardsley','Audrey Flack','Auguste Rodin','Banksy','Barbara Kruger','Ben Shahn','Bridget Riley','Bruce Nauman','Camille Pissarro','Caravaggio','Caspar David Friedrich','Charles Demuth','Chuck Close','Cindy Sherman','Claude Monet','Clyfford Still','Dante Gabriel Rossetti','David Hockney','Diego Rivera','Diego Velázquez','Donald Judd','Edgar Degas','Edouard Manet','Edvard Munch','Edward Burne-Jones','Edward Hopper','Egon Schiele','El Greco','El Lissitzky','Ellsworth Kelly','Ernst Ludwig Kirchner','Eugene Delacroix','Eva Hesse','Fernand Léger','Francis Bacon','Francisco Goya','Frank Stella','Frans Hals','Frida Kahlo','George Bellows','George Grosz','Georges Braque','Georges Seurat','Georgia O\'Keeffe','Giacomo Balla','Giorgio De Chirico','Giorgio Morandi','Giotto Di Bondone','Gustav Klimt','Gustave Courbet','Gustave Moreau','Hannah Höch','Hans Holbein The Younger','Helen Frankenthaler','Henri Cartier-Bresson','Henri Matisse','Henri Rousseau','Henry Darger','Hieronymus Bosch','J.M.W. Turner','Jackson Pollock','Jacques-Louis David','James Abbott Mcneill Whistler','Jan Vermeer','Jean Dubuffet','Jean-Michel Basquiat','Jeff Koons','Jenny Saville','Joan Miró','John Everett Millais','John Singer Sargent','John William Waterhouse','Josef Albers','Juan Gris','Judy Chicago','Kara Walker','Katsushika Hokusai','Kazimir Malevich','Keith Haring','Leonardo Da Vinci','Louise Bourgeois','Lucian Freud','Man Ray','Marc Chagall','Marcel Duchamp','Mark Rothko','Mary Cassatt','Max Ernst','Michelangelo','Odilon Redon','Olafur Eliasson','Pablo Picasso','Paul Cezanne','Paul Gauguin','Paul Klee','Paul Signac','Peter Paul Rubens','Pierre-Auguste Renoir','Piet Mondrian','Pieter Bruegel The Elder','Raphael','Rembrandt','Rene Magritte','Robert Smithson','Roy Lichtenstein','Salvador Dali','Sandro Botticelli','Shepard Fairey','Sol Lewitt','Sonia Delaunay','Takashi Murakami','Tamara De Lempicka','Thomas Cole','Titian','Umberto Boccioni','Utagawa Hiroshige','Vasily Kandinsky','Victor Vasarely','Vincent Van Gogh','Wassily Kandinsky','Willem De Kooning','William Blake','Yayoi Kusama','Yoshitomo Nara','Yves Klein','Zaha Hadid'],
  },
  {
    group: 'Character Types',
    items: ['Acolyte','Acrobat','Apothecary','Artificer','Artisan','Barbarian','Bard','Blood Hunter','Bounty Hunter','Cavalier','Champion','Charlatan','Cleric','Clown','Druid','Duelist','Executioner','Exorcist','Explorer','Fighter','Gladiator','Hermit','Knight','Monk','Mystic','Noble','Outlander','Paladin','Pirate','Ranger','Rogue','Sage','Sailor','Shaman','Soldier','Sorcerer','Urchin','Warden','Warlock','Warlord','Wizard'],
  },
  {
    group: 'Colors',
    items: ['Almond Color','Amber','Apricot Orange','Ash Gray','Beige','Black','Blue','Brick Red','Bronze','Brown','Caramel Color','Carnation Pink','Cerulean','Charcoal Grey','Coral Orange','Cream Color','Cyan','Denim Blue','Emerald Green','Forest Green','Fuchsia','Gold','Grass Green','Green','Indigo','Ivory Color','Jade Green','Lavender','Lemon Yellow','Lilac Purple','Lime Green','Magenta','Mahogany','Marigold','Maroon','Mauve','Midnight Blue','Mint Green','Mocha Brown','Navy Blue','Olive Green','Orange','Orchid Pink','Peach Color','Pearl Color','Periwinkle','Pink','Plum Purple','Purple','Red','Rose','Ruby Red','Rust Brown','Salmon Pink','Sand Color','Sapphire Blue','Seafoam Green','Sienna','Silver','Sky Blue','Slate Gray','Steel Blue','Tan Brown','Tangerine Orange','Teal','Terracotta Orange','Topaz Yellow','Turquoise','Vanilla Color','Violet','White','Wine Red','Yellow'],
  },
  {
    group: 'Composition',
    items: ['Beauty Shot','Bird\'s Eye View','Black And White Portrait','Candid Shot','Double Exposure Portrait','Environmental Portrait','Extreme Close-Up','Framed Portrait','Frontal','Full Shot','Group Shot','Headshot','High Angle','High-Key Portrait','Infrared Portrait','Low Angle','Macro','Medium Close-Up','Medium Shot','Micro','Motion Blur Portrait','Narrative Portrait','Outdoor Portrait','Over-The-Shoulder','Profile','Reflection Portrait','Silhouette','Studio Portrait','Surreal Portrait','Three-Quarter View','Two-Shot','Worm\'s Eye View'],
  },
  {
    group: 'Composition Form',
    items: ['Afterimage','Border','Collage','Cropped','Diagram','Framed','Isometric','Letterboxed','Lineup','Mosaic Art','Negative Space','Out Of Frame','Partially Underwater Shot','Photomosaic','Pillarboxed','Polar Opposites','Reference Sheet','Rotational Symmetry','Rounded Corners','Symmetry','Viewfinder','Zoom Layer'],
  },
  {
    group: 'Lighting',
    items: ['Artificial Indoor Lighting','Back Lighting','Bright And Sunny Lighting','Broad Lighting','Butterfly Lighting','Candlelit Scene Lighting','Clamshell Lighting','Cool And Blue Lighting','Dappled Sunlight Through Leaves Lighting','Dim And Cozy Lighting','Dramatic High Contrast Lighting','Dramatic Spotlight Lighting','Ethereal Moonlight Lighting','Firelight Flicker Lighting','Fluorescent Office Lighting','Futuristic Neon Glow Lighting','Glowing Neon Lighting','Golden Hour Lighting','Hard Shadows Lighting','Harsh Overhead Lighting','High Key Lighting','Light Painting Lighting','Loop Lighting','Low Key Lighting','Majestic Lighting','Moody And Mysterious Lighting','Moonlit Forest Lighting','Natural Sunlight Lighting','Neon Glow Lighting','Night Photography Lighting','Product Lighting','Radiant Angelic Lighting','Rembrandt Lighting','Rim Lighting','Romantic Candlelight Lighting','Rustic Campfire Lighting','Rustic Fireplace Lighting','Sci-Fi Futuristic Lighting','Short Lighting','Side Lighting','Silhouette Lighting','Soft And Diffused Lighting','Soft And Warm Lighting','Soft Shadows Lighting','Split Lighting','Starry Night Lighting','Still Life Lighting','Studio Portrait Lighting','Sunrise At The Mountains Lighting','Sunrise Over The Ocean Lighting','Sunset Silhouette Lighting','Twinkling Fairy Lights Lighting','Under The Streetlights Lighting','Underwater Illumination Lighting','Vibrant Stage Lighting','Vintage Film Noir Lighting','Warm Sunset Glow Lighting','Whimsical Fairy Tale Lighting'],
  },
  {
    group: 'Negative',
    items: ['Blurry, Text, Watermark, Signature, Frame','Disfigure Body, Disfigured Torso, Disfigured Face, Disfigured Eyes, Disfigured Pupils, Disfigured Arms, Disfigured Hands, Disfigured Fingers, Disfigured Legs, Disfigured Toes'],
  },
  {
    group: 'Picture Effect',
    items: ['Anaglyph','Blending','Bloom','Blurry','Chromatic Aberration','Cinematic Lighting','Depth Of Field','Dithering','Drop Shadow','Film Grain','Fujicolor','Glowing Light','God Rays','Halftone','Jpeg Artifacts','Motion Blur','Motion Lines','Optical Illusion','Ray Tracing','Scanlines','Sparkle','Speed Lines','Vignetting'],
  },
  {
    group: 'Picture Quality',
    items: ['1080P','16K','4K','8K','Accurate','Anatomically Correct','Award Winning','Best Quality','HD','High Quality','Highres','Masterpiece','Retina','Super Detail','Textured Skin','UHD'],
  },
  {
    group: 'Setting',
    items: ['Ancient Civilization Setting','Ancient Gods Setting','Apocalyptic Earth Setting','Arctic Setting','Artificial Intelligence Setting','Biopunk Setting','City Of Tomorrow Setting','Cosmic Horror Setting','Cyberpunk Setting','Desert Setting','Detective Noir Setting','Dream World Setting','Dystopian Setting','Fairytale Setting','Fantasy Setting','Futuristic Setting','Galactic Empire Setting','Haunted Mansion Setting','Historical Setting','Jungle Setting','Lost Civilization Setting','Lunar Colony Setting','Magical School Setting','Medieval Setting','Mythological Setting','Ocean Exploration Setting','Parallel Universe Setting','Pirate Adventure Setting','Post-Apocalyptic Setting','Sci-Fi Setting','Space Setting','Space Opera Setting','Steampunk Setting','Superhero Setting','Surreal Setting','Time Travel Setting','Underwater Setting','Urban Setting','Victorian Setting','Virtual Reality Setting','Wild West Setting'],
  },
  {
    group: 'Shot',
    items: ['135Mm','35Mm','360 View','85Mm','Bokeh','Canon','Caustics','Diffraction Spikes','Eye-Level Shot','F/1.2','F/1.8','F/16','F/2.8','F/4.0','Foreshortening','Fujifilm','Hasselblad','Lens Flare','Macro Photo','Nikon','Overexposure','Satellite Image','Sony Fe','Sony Fe Gm','Ultra-Wide Angle','Wide-Angle'],
  },
  {
    group: 'Style',
    items: ['Abstract Art Style','Abstract Expressionism Style','Abstract Landscapes Style','Abstractionism Style','Acrylic Painting Style','Action Painting Style','American Impressionism Style','Anime Style','Art Brut Style','Art Deco Style','Art Nouveau Style','Baroque Style','Batik Style','Bauhaus Style','Byzantine Art Style','Charcoal Drawing Style','Chiaroscuro Style','Classicism Style','Color Field Painting Style','Colored Pencil Drawing Style','Conceptual Art Style','Constructivism Style','Contemporary Art Style','Cubism Style','Dada Style','De Stijl Style','Digital Art Style','Dutch Golden Age Style','Expressionism Style','Fauvism Style','Folk Art Style','Futurism Style','Ghibli-Like Colors Style','Gothic Art Style','Gothic Revival Style','Gouache Painting Style','Graffiti Art Style','Hyperrealism Style','Impressionism Style','Industrial Design Style','Islamic Art Style','Kinetic Art Style','Land Art Style','Magic Realism Style','Mannerism Style','Medieval Art Style','Minimalism Style','Mixed Media Style','Modern Style','Monet Style','Mosaic Style','Naive Art Style','Neoclassicism Style','Neo-Expressionism Style','Neo-Impressionism Style','Oil Painting Style','Op Art Style','Pastel Painting Style','Pen And Ink Drawing Style','Photorealism Style','Pixar Style','Pointillism Style','Pop Art Style','Post-Impressionism Style','Postmodernism Style','Pre-Raphaelite Brotherhood Style','Realism Style','Renaissance Style','Rococo Style','Romanticism Style','Screen Printing Style','Social Realism Style','Stained Glass Style','Street Art Style','Superflat Style','Suprematism Style','Surrealism Style','Symbolism Style','Trompe-L\'Oeil Style','Ukiyo-E Style','Victorian Art Style','Watercolor Style','Wildlife Art Style','Woodcut Style'],
  },
]

const GROUP_PT: Record<string, string> = {
  'Angle of View': 'Ângulo de Visão',
  'Artists': 'Artistas',
  'Character Types': 'Tipos de Personagem',
  'Colors': 'Cores',
  'Composition': 'Composição',
  'Composition Form': 'Forma de Composição',
  'Lighting': 'Iluminação',
  'Negative': 'Negativo',
  'Picture Effect': 'Efeito de Imagem',
  'Picture Quality': 'Qualidade de Imagem',
  'Setting': 'Cenário',
  'Shot': 'Tomada',
  'Style': 'Estilo',
}

export default function PromptPresets() {
  const [open, setOpen] = useState(false)
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [showCategories, setShowCategories] = useState(false)
  const [search, setSearch] = useState('')
  const appLang = useCanvasStore(s => s.appLang)
  const [translated, setTranslated] = useState(appLang === 'pt')
  const [translating, setTranslating] = useState(false)
  const [transMap, setTransMap] = useState<Record<string, string>>({})

  // Segue o idioma global do app (mas o botão ainda permite trocar localmente).
  useEffect(() => { setTranslated(appLang === 'pt') }, [appLang])
  const addTag = usePromptStore(s => s.addTag)
  const { myPresets, addPreset, removePreset, editPreset } = useMyPresets()
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setShowCategories(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    const handler = (e: CustomEvent<{ value: string }>) => {
      addPreset(e.detail.value)
      setSavedFeedback(e.detail.value)
      setTimeout(() => setSavedFeedback(null), 2000)
    }
    window.addEventListener('save-to-my-presets', handler as EventListener)
    return () => window.removeEventListener('save-to-my-presets', handler as EventListener)
  }, [addPreset])

  const handleAdd = (value: string) => {
    addTag({ id: crypto.randomUUID(), category: 'description', value, source: 'metadata' }, '')
  }

  const allItems = PRESETS.flatMap(g => g.items)
  const currentItems = activeGroup === 'Meus Presets'
    ? myPresets
    : activeGroup
      ? (PRESETS.find(g => g.group === activeGroup)?.items ?? [])
      : allItems

  // Texto exibido para um item / nome de grupo conforme o idioma ativo.
  const disp = (item: string) => translated ? (transMap[item] ?? item) : item
  const dispGroup = (g: string) => translated ? (GROUP_PT[g] ?? g) : g

  // Carrega o cache de traduções salvo em disco (presets são fixos, então a
  // tradução é estável e não precisa ser refeita entre reinícios do app).
  useEffect(() => {
    window.api.getSetting('presetTranslations_pt').then(raw => {
      if (raw) try { setTransMap(JSON.parse(raw)) } catch {}
    })
  }, [])

  // Quando a tradução está ativa, garante que os itens do grupo atual estejam
  // traduzidos (em lotes, com cache). Presets do usuário não são traduzidos.
  useEffect(() => {
    if (!translated || activeGroup === 'Meus Presets') return
    const missing = currentItems.filter(i => !(i in transMap))
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      setTranslating(true)
      try {
        const CHUNK = 40
        const updates: Record<string, string> = {}
        for (let i = 0; i < missing.length; i += CHUNK) {
          const batch = missing.slice(i, i + CHUNK)
          const res = await window.api.translateTags(batch, 'pt')
          batch.forEach((orig, j) => { if (res[j]) updates[orig] = res[j] })
        }
        if (!cancelled) setTransMap(prev => {
          const merged = { ...prev, ...updates }
          window.api.setSetting('presetTranslations_pt', JSON.stringify(merged))
          return merged
        })
      } catch (e) {
        console.error('[presets-translate]', e)
      } finally {
        if (!cancelled) setTranslating(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translated, activeGroup])

  const filtered = search
    ? currentItems.filter(i => {
        const s = search.toLowerCase()
        return i.toLowerCase().includes(s) || disp(i).toLowerCase().includes(s)
      })
    : currentItems

  return (
    <div ref={containerRef}>
      <button
        onClick={() => { setOpen(v => !v); setActiveGroup(null); setSearch(''); setShowCategories(false) }}
        title="Presets de prompt"
        className={`
          absolute top-3 left-[300px] z-40
          w-9 h-9 flex items-center justify-center rounded-xl
          rm-panel !border-transparent transition-all
          ${open ? 'text-orange-400/80' : 'text-white/40 hover:text-white/70'}
        `}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <path d="M2 4h12M2 8h8M2 12h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="13" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M13 9.5V11l1 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div
          className="absolute top-[52px] left-[300px] z-40 w-[280px] rounded-2xl overflow-hidden"
          style={{
            maxHeight: '460px',
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(22, 20, 18, 0.72)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 25px 50px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          {/* Category selector */}
          <div className="relative px-2 pt-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowCategories(v => !v)}
                className="flex-1 flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.07] hover:bg-white/[0.07] transition-colors"
              >
                <span className="text-[11px] font-semibold text-orange-400/80">{activeGroup ? dispGroup(activeGroup) : 'Categorias'}</span>
                <svg width="10" height="10" viewBox="0 0 10 6" fill="none">
                  <path d={showCategories ? 'M1 5L5 1L9 5' : 'M1 1L5 5L9 1'} stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                onClick={() => setTranslated(v => !v)}
                disabled={translating}
                title={translating ? 'Traduzindo...' : translated ? 'Voltar para inglês' : 'Traduzir para português'}
                className={`text-[11px] px-2 py-2 rounded-lg border transition-colors shrink-0 inline-flex items-center gap-1 ${
                  translating
                    ? 'text-white/30 border-white/[0.07] cursor-default bg-white/[0.04]'
                    : translated
                      ? 'text-white/70 border-white/[0.15] bg-white/[0.08] hover:bg-white/[0.12]'
                      : 'text-white/40 border-white/[0.07] bg-white/[0.04] hover:text-white/70 hover:bg-white/[0.07]'
                }`}
              >
                {translating && (
                  <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
                    <path d="M12 3a9 9 0 019 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                )}
                <span>{translated ? 'EN' : 'PT-BR'}</span>
              </button>
            </div>
            {showCategories && (
              <div className="absolute left-2 right-2 top-full mt-1 z-50 rounded-xl border border-white/[0.1] overflow-y-auto" style={{ maxHeight: '220px', background: 'rgba(22, 20, 18, 0.85)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }} data-scrollable>
                <button
                  onClick={() => { setActiveGroup(null); setSearch(''); setShowCategories(false) }}
                  className={`w-full text-left px-3 py-2 text-[11px] transition-colors border-b border-white/[0.05] ${
                    activeGroup === null ? 'text-orange-400/90 bg-orange-500/10' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.05]'
                  }`}
                >
                  Todas
                </button>
                {myPresets.length > 0 && (
                  <button
                    onClick={() => { setActiveGroup('Meus Presets'); setSearch(''); setShowCategories(false) }}
                    className={`w-full text-left px-3 py-2 text-[11px] transition-colors border-b border-white/[0.05] ${
                      activeGroup === 'Meus Presets' ? 'text-orange-400/90 bg-orange-500/10' : 'text-orange-400/70 hover:text-orange-400 hover:bg-orange-500/[0.08]'
                    }`}
                  >
                    ★ Meus Presets
                  </button>
                )}
                {PRESETS.map(g => (
                  <button
                    key={g.group}
                    onClick={() => { setActiveGroup(g.group); setSearch(''); setShowCategories(false) }}
                    className={`w-full text-left px-3 py-2 text-[11px] transition-colors ${
                      activeGroup === g.group
                        ? 'text-orange-400/90 bg-orange-500/10'
                        : 'text-white/50 hover:text-white/80 hover:bg-white/[0.05]'
                    }`}
                  >
                    {dispGroup(g.group)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Search */}
          <div className="px-2 pt-2 pb-1 shrink-0">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              placeholder="Filtrar..."
              className="w-full bg-white/[0.04] border border-white/[0.07] rounded-lg px-3 py-1.5 text-[11px] text-white/60 placeholder-white/20 outline-none focus:border-orange-500/30"
            />
          </div>

          {/* Items */}
          <div className="overflow-y-auto p-1 flex flex-col gap-0.5" data-scrollable>
            {filtered.map(item => (
              activeGroup === 'Meus Presets' && editingItem === item ? (
                <div key={item} className="flex items-center gap-1 px-2 py-1">
                  <input
                    autoFocus
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => {
                      e.stopPropagation()
                      if (e.key === 'Enter') { editPreset(item, editValue); setEditingItem(null) }
                      if (e.key === 'Escape') setEditingItem(null)
                    }}
                    onBlur={() => { editPreset(item, editValue); setEditingItem(null) }}
                    className="flex-1 bg-white/[0.06] border border-orange-500/30 rounded-lg px-2 py-1 text-[11.5px] text-white/80 outline-none"
                  />
                </div>
              ) : (
                <div key={item} className="group flex items-center gap-1 px-1 rounded-lg hover:bg-white/[0.05] transition-colors">
                  <button
                    onClick={() => handleAdd(disp(item))}
                    className="flex-1 text-left px-2 py-1.5 text-[11.5px] text-white/50 group-hover:text-white/85 transition-colors"
                  >
                    {disp(item)}
                  </button>
                  {activeGroup === 'Meus Presets' && (
                    <>
                      <button
                        onClick={() => { setEditingItem(item); setEditValue(item) }}
                        className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded-md hover:bg-white/[0.08] transition-all text-white/30 hover:text-white/60 shrink-0"
                        title="Editar"
                      >
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                          <path d="M8.5 1.5l2 2L4 10H2v-2L8.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <button
                        onClick={() => removePreset(item)}
                        className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-500/15 transition-all text-white/30 hover:text-red-400 shrink-0"
                        title="Remover"
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              )
            ))}
            {filtered.length === 0 && (
              <p className="text-center text-[11px] text-white/20 py-4">Nenhum resultado</p>
            )}
          </div>
        </div>
      )}
      {savedFeedback && (
        <div className="absolute top-[52px] left-[300px] z-50 px-3 py-2 rounded-xl rm-panel !border-transparent text-[11px] whitespace-nowrap"
          style={{ color: '#F97316', borderColor: 'rgba(249,115,22,0.2)', background: 'rgba(249,115,22,0.08)' }}>
          ★ Salvo em Meus Presets
        </div>
      )}
    </div>
  )
}

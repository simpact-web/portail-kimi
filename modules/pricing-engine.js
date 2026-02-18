/**
 * SIMPACT PRICING ENGINE v2.0
 * Moteur de tarification centralisé - Imprimerie Numérique
 * Compatible : Flyers, Cartes, Dépliants, En-têtes, Brochures, Livres, Affiches
 */

const PricingEngine = {
    config: null,
    initialized: false,

    // Constantes métier (centrailsées ici, pas dans les HTML)
    PRIX_FIXES: {
        pelliculage: 0.1,
        feuille_nb: 0.2,
        offset_100: 0.014,
        gramme_couche: 0.0007,
        min_price: 28
    },

    // Données PAO (création graphique)
    PAO_DATA: {
        'flyer': { conc: 4, corr: 2, layout: 2 },
        'carte': { conc: 1, corr: 0.5, layout: 0.5 },
        'depliant': { conc: 8, corr: 3, layout: 3 },
        'entete': { conc: 4, corr: 2, layout: 2 },
        'affiches': { conc: 7, corr: 1, layout: 1 },
        'brochure': { conc: 8, corr: 0.17, layout: 0.34, perPage: true },
        'livre': { conc: 12, corr: 0.17, layout: 0.25, perPage: true }
    },

    PAO_A5_FACTOR: {
        'brochure': { corr: 0.119, layout: 0.238 },
        'livre': { corr: 0.119, layout: 0.175 }
    },

    PAO_RATES: {
        'conception': 55,
        'layout': 40,
        'correction': 40
    },

    /**
     * Initialisation - Charge la configuration depuis prix_config.json
     */
    async init() {
        if (this.initialized) return this;
        
        try {
            const response = await fetch('prix_config.json');
            this.config = await response.json();
            this.initialized = true;
            console.log('✅ PricingEngine initialisé');
            return this;
        } catch (e) {
            console.error('❌ Erreur chargement prix_config.json:', e);
            // Fallback avec données minimales
            this.config = this.getDefaultConfig();
            this.initialized = true;
            return this;
        }
    },

    /**
     * Configuration par défaut (fallback)
     */
    getDefaultConfig() {
        return {
            tarifs: {
                flyer: { recto: [], rectoVerso: [] },
                carte: { recto: [], pellicule: [] },
                depliant: [],
                entete: [],
                affiche: []
            },
            prix_couverture_livre: {
                a4: { recto: 1.3, rectoVerso: 1.5 },
                a5: { recto: 0.65, rectoVerso: 0.75 }
            },
            paliers_brochure: { couleur_recto_verso: [] },
            prix_fixes: this.PRIX_FIXES
        };
    },

    /**
     * CALCUL PRINCIPAL - Point d'entrée unique
     * @param {string} productType - Type de produit (flyer, carte, etc.)
     * @param {Object} options - Options spécifiques au produit
     * @param {number} quantity - Quantité demandée
     * @param {Object} paoOptions - Options création graphique (optionnel)
     * @returns {Object} Résultat complet du devis
     */
    calculate(productType, options, quantity, paoOptions = null) {
        if (!this.initialized) {
            console.warn('PricingEngine non initialisé, appel de init()...');
            return { error: 'Engine not initialized' };
        }

        if (!quantity || quantity <= 0) {
            return { error: 'Quantité invalide' };
        }

        let result = {
            productType,
            quantity,
            basePrice: 0,
            surcharges: [],
            paoCost: 0,
            totalPrice: 0,
            details: {},
            breakdown: []
        };

        try {
            switch (productType) {
                case 'flyer':
                    result = this.calculateFlyer(options, quantity, result);
                    break;
                case 'carte':
                    result = this.calculateCarte(options, quantity, result);
                    break;
                case 'depliant':
                    result = this.calculateDepliant(options, quantity, result);
                    break;
                case 'entete':
                    result = this.calculateEntete(options, quantity, result);
                    break;
                case 'brochure':
                    result = this.calculateBrochure(options, quantity, result);
                    break;
                case 'livre':
                    result = this.calculateLivre(options, quantity, result);
                    break;
                case 'affiches':
                    result = this.calculateAffiches(options, quantity, result);
                    break;
                default:
                    return { error: 'Produit inconnu: ' + productType };
            }

            // Application prix minimum
            if (result.basePrice < this.PRIX_FIXES.min_price) {
                result.breakdown.push({
                    label: 'Ajustement prix minimum',
                    amount: this.PRIX_FIXES.min_price - result.basePrice
                });
                result.basePrice = this.PRIX_FIXES.min_price;
            }

            // Calcul PAO si demandé
            if (paoOptions && paoOptions.type !== 'none') {
                result = this.calculatePAO(productType, paoOptions, options, result);
            }

            // Total final
            result.totalPrice = result.basePrice + result.surcharges.reduce((s, i) => s + i.amount, 0) + result.paoCost;
            
            // Arrondi à 2 décimales
            result.totalPrice = Math.round(result.totalPrice * 100) / 100;

            return result;

        } catch (e) {
            console.error('Erreur calcul:', e);
            return { error: e.message };
        }
    },

    /**
     * CALCUL FLYERS
     */
    calculateFlyer(options, quantity, result) {
        const mode = options.mode || 'recto'; // recto ou rectoVerso
        const paper = options.paper || 'couche-90-mat';
        
        const tarif = this.config.tarifs.flyer[mode];
        if (!tarif) throw new Error('Tarif flyer non trouvé');

        const calc = this.calculatePriceWithSmoothing(tarif, quantity);
        result.basePrice = calc.totalPrice;
        
        const paperSurcharge = this.calculatePaperSurcharge(paper, quantity);
        if (paperSurcharge > 0) {
            result.surcharges.push({
                label: `Supplément papier ${this.getPaperName(paper)}`,
                amount: paperSurcharge
            });
        }

        result.details = {
            impression: mode === 'recto' ? 'Recto' : 'Recto/Verso',
            papier: this.getPaperName(paper),
            format: 'Standard'
        };

        return result;
    },

    /**
     * CALCUL CARTES DE VISITE
     */
    calculateCarte(options, quantity, result) {
        const finish = options.finish || 'recto'; // recto ou pellicule
        const paper = options.paper || 'couche-300-mat';
        
        const tarif = this.config.tarifs.carte[finish];
        if (!tarif) throw new Error('Tarif carte non trouvé');

        const calc = this.calculatePriceWithSmoothing(tarif, quantity);
        result.basePrice = calc.totalPrice;
        
        // Cartes : calcul par lot de 10 pour le papier
        const paperSurcharge = this.calculatePaperSurcharge(paper, Math.ceil(quantity / 10));
        if (paperSurcharge > 0) {
            result.surcharges.push({
                label: `Supplément papier ${this.getPaperName(paper)}`,
                amount: paperSurcharge
            });
        }

        result.details = {
            finition: finish === 'recto' ? 'Standard' : 'Pelliculée',
            papier: this.getPaperName(paper)
        };

        return result;
    },

    /**
     * CALCUL DÉPLIANTS
     */
    calculateDepliant(options, quantity, result) {
        const paper = options.paper || 'couche-115-mat';
        
        const tarif = this.config.tarifs.depliant;
        if (!tarif) throw new Error('Tarif dépliant non trouvé');

        const calc = this.calculatePriceWithSmoothing(tarif, quantity);
        result.basePrice = calc.totalPrice;
        
        const paperSurcharge = this.calculatePaperSurcharge(paper, quantity);
        if (paperSurcharge > 0) {
            result.surcharges.push({
                label: `Supplément papier ${this.getPaperName(paper)}`,
                amount: paperSurcharge
            });
        }

        result.details = {
            format: '3 Volets (A4 Ouvert)',
            papier: this.getPaperName(paper)
        };

        return result;
    },

    /**
     * CALCUL EN-TÊTES
     */
    calculateEntete(options, quantity, result) {
        const paper = options.paper || 'offset-80';
        
        const tarif = this.config.tarifs.entete;
        if (!tarif) throw new Error('Tarif en-tête non trouvé');

        const calc = this.calculatePriceWithSmoothing(tarif, quantity);
        result.basePrice = calc.totalPrice;
        
        const paperSurcharge = this.calculatePaperSurcharge(paper, quantity);
        if (paperSurcharge > 0) {
            result.surcharges.push({
                label: `Supplément papier ${this.getPaperName(paper)}`,
                amount: paperSurcharge
            });
        }

        result.details = {
            format: 'A4',
            papier: this.getPaperName(paper)
        };

        return result;
    },

    /**
     * CALCUL BROCHURES (Complexe)
     */
    calculateBrochure(options, quantity, result) {
        const pages = parseInt(options.pages) || 8;
        const format = options.format || 'a4';
        const coverType = options.coverType || 'recto'; // recto ou rectoVerso
        const pelliculage = options.pelliculage || 'sans';
        const paperInt = options.paperInt || 'couche-90-mat';
        const paperCov = options.paperCov || 'couche-250-mat';
        const finition = options.finition || 'Piquée à cheval';

        // Calcul feuilles intérieur
        const sheetsInt = Math.ceil((pages / (format === 'a4' ? 4 : 8)) * quantity);
        const sheetsCov = Math.ceil((format === 'a4' ? 1 : 0.5) * quantity);
        const totalSheets = sheetsInt + sheetsCov;

        // Prix par feuille selon paliers
        const priceSheetInt = this.getPricePerSheetCouleur(totalSheets);
        const priceSheetCov = coverType === 'recto' 
            ? this.getPricePerSheetRecto(totalSheets) 
            : this.getPricePerSheetCouleur(totalSheets);

        const costInt = sheetsInt * priceSheetInt;
        const costCov = sheetsCov * priceSheetCov;

        // Surcharges papier
        const surchargeInt = this.calculatePaperSurcharge(paperInt, sheetsInt);
        const surchargeCov = this.calculatePaperSurcharge(paperCov, sheetsCov);
        const totalSurcharge = surchargeInt + surchargeCov;

        // Pelliculage
        const costPell = pelliculage === 'avec' ? quantity * this.PRIX_FIXES.pelliculage : 0;

        result.basePrice = costInt + costCov;
        
        if (totalSurcharge > 0) {
            result.surcharges.push({
                label: 'Supplément papier',
                amount: totalSurcharge
            });
        }
        
        if (costPell > 0) {
            result.surcharges.push({
                label: 'Pelliculage couverture',
                amount: costPell
            });
        }

        result.details = {
            format: format.toUpperCase(),
            pages: pages,
            finition: finition,
            papierInt: this.getPaperName(paperInt),
            papierCov: this.getPaperName(paperCov),
            impressionCov: coverType === 'recto' ? 'Recto' : 'Recto/Verso',
            pelliculage: pelliculage === 'avec' ? 'Oui' : 'Non'
        };

        return result;
    },

    /**
     * CALCUL LIVRES N&B (Complexe)
     */
    calculateLivre(options, quantity, result) {
        const pages = parseInt(options.pages) || 50;
        const format = options.format || 'a4';
        const coverType = options.coverType || 'recto';
        const pelliculage = options.pelliculage || 'sans';
        const paperInt = options.paperInt || 'offset-80';
        const paperCov = options.paperCov || 'couche-250-mat';

        // Feuilles intérieur N&B
        const sheetsInt = Math.ceil((pages / (format === 'a4' ? 4 : 8)) * quantity);
        const costInt = sheetsInt * this.PRIX_FIXES.feuille_nb;
        const surchargeInt = this.calculatePaperSurcharge(paperInt, sheetsInt);

        // Couverture couleur
        const unitCovPrice = coverType === 'recto' 
            ? this.config.prix_couverture_livre[format].recto 
            : this.config.prix_couverture_livre[format].rectoVerso;
        const costCov = quantity * unitCovPrice;

        // Pelliculage
        const costPell = pelliculage === 'avec' ? quantity * this.PRIX_FIXES.pelliculage : 0;

        result.basePrice = costInt + costCov;
        
        if (surchargeInt > 0) {
            result.surcharges.push({
                label: 'Supplément papier intérieur',
                amount: surchargeInt
            });
        }
        
        if (costPell > 0) {
            result.surcharges.push({
                label: 'Pelliculage',
                amount: costPell
            });
        }

        result.details = {
            format: format.toUpperCase(),
            pages: pages,
            reliure: 'Spirale Plastique',
            papierInt: this.getPaperName(paperInt),
            papierCov: this.getPaperName(paperCov),
            impressionCov: coverType === 'recto' ? 'Recto' : 'Recto/Verso',
            pelliculage: pelliculage === 'avec' ? 'Oui' : 'Non'
        };

        return result;
    },

    /**
     * CALCUL AFFICHES GRAND FORMAT
     */
    calculateAffiches(options, quantity, result) {
        const format = options.format || 'a3';
        const paper = options.paper || 'couche-135-mat';
        
        const tarif = this.config.tarifs.affiche;
        if (!tarif) throw new Error('Tarif affiche non trouvé');

        const calc = this.calculatePriceWithSmoothing(tarif, quantity);
        let unitPrice = calc.totalPrice;
        
        // Majoration A3+
        if (format === 'a3plus') {
            unitPrice *= 1.2;
        }

        result.basePrice = unitPrice * quantity;
        
        const paperSurcharge = this.calculatePaperSurcharge(paper, quantity);
        if (paperSurcharge > 0) {
            result.surcharges.push({
                label: `Supplément papier ${this.getPaperName(paper)}`,
                amount: paperSurcharge
            });
        }

        result.details = {
            format: format === 'a3' ? 'A3 (30x42 cm)' : 'A3+ (32x48 cm)',
            papier: this.getPaperName(paper)
        };

        return result;
    },

    /**
     * CALCUL PAO (Création Graphique)
     */
    calculatePAO(productType, paoOptions, productOptions, result) {
        const type = paoOptions.type; // conception, layout, correction
        const data = this.PAO_DATA[productType];
        
        if (!data) return result;

        let hours = 0;
        const rate = this.PAO_RATES[type];
        const key = type === 'conception' ? 'conc' : type === 'layout' ? 'layout' : 'corr';

        if (data.perPage) {
            // Produits par page (brochure, livre)
            const pages = parseInt(productOptions.pages) || 0;
            const format = productOptions.format || 'a4';
            
            if (type === 'conception') {
                hours = data.conc;
            } else {
                let unitHours = data[key];
                if (format === 'a5' && this.PAO_A5_FACTOR[productType]) {
                    unitHours = this.PAO_A5_FACTOR[productType][key];
                }
                hours = unitHours * pages;
            }
        } else {
            // Produits fixes
            hours = data[key];
        }

        result.paoCost = hours * rate;
        result.paoDetails = {
            service: type,
            hours: Math.round(hours * 100) / 100,
            rate: rate,
            description: this.getPAODescription(type, hours)
        };

        return result;
    },

    /**
     * UTILITAIRES DE CALCUL
     */

    // Lissage des prix entre paliers
    calculatePriceWithSmoothing(tarifArray, quantity) {
        if (!tarifArray || tarifArray.length === 0) {
            return { totalPrice: 0 };
        }

        let lower = tarifArray[0];
        let upper = tarifArray[0];

        for (let t of tarifArray) {
            if (t.qty <= quantity) lower = t;
            if (t.qty >= quantity && upper === tarifArray[0]) upper = t;
        }

        if (lower.qty === upper.qty) {
            return { totalPrice: lower.price };
        }

        const ratio = (quantity - lower.qty) / (upper.qty - lower.qty);
        const price = lower.price + (upper.price - lower.price) * ratio;
        
        return { totalPrice: price };
    },

    // Prix par feuille couleur (brochures)
    getPricePerSheetCouleur(sheets) {
        if (sheets < 25) return 3;
        if (sheets < 50) return 2.5;
        if (sheets < 100) return 2;
        if (sheets < 200) return 1.9;
        if (sheets < 300) return 1.8;
        if (sheets < 400) return 1.7;
        if (sheets < 500) return 1.6;
        return 1.5;
    },

    getPricePerSheetRecto(sheets) {
        return this.getPricePerSheetCouleur(sheets) - 0.2;
    },

    // Surcharge papier selon grammage
    calculatePaperSurcharge(paperType, numSheets) {
        if (!paperType || numSheets === 0) return 0;
        
        if (paperType === 'offset-100') {
            return numSheets * this.PRIX_FIXES.offset_100;
        }
        
        if (paperType.startsWith('couche-')) {
            const parts = paperType.split('-');
            if (parts.length >= 2) {
                const grammage = parseInt(parts[1]);
                if (grammage > 90) {
                    return numSheets * (grammage - 90) * this.PRIX_FIXES.gramme_couche;
                }
            }
        }
        
        return 0;
    },

    // Nom lisible du papier
    getPaperName(paperType) {
        if (!paperType) return '';
        if (paperType === 'offset-80') return 'Offset 80gr Standard';
        if (paperType === 'offset-100') return 'Offset 100gr Premium';
        
        if (paperType.startsWith('couche-')) {
            const parts = paperType.split('-');
            const grammage = parts[1] || '';
            const finish = parts[2] === 'mat' ? 'Mat' : 'Brillant';
            return `Couché ${grammage}gr ${finish}`;
        }
        
        return paperType;
    },

    getPAODescription(type, hours) {
        const labels = {
            'conception': 'Création complète',
            'layout': 'Mise en page',
            'correction': 'Correction simple'
        };
        return `${labels[type] || type} (${hours.toFixed(2)}h)`;
    },

    /**
     * GÉNÉRATION DE CONFIGURATION TEXTE (pour affichage)
     */
    generateConfigString(productType, options, paoOptions) {
        const result = this.calculate(productType, options, options.quantity || 0, paoOptions);
        
        if (result.error) return 'Configuration non disponible';

        let config = '';
        
        switch (productType) {
            case 'flyer':
                config = `Format Standard\nImpression: ${result.details.impression}\nPapier: ${result.details.papier}`;
                break;
            case 'carte':
                config = `Finition: ${result.details.finition}\nPapier: ${result.details.papier}`;
                break;
            case 'depliant':
                config = `3 Volets (A4 Ouvert)\nPapier: ${result.details.papier}`;
                break;
            case 'entete':
                config = `Format A4\nPapier: ${result.details.papier}`;
                break;
            case 'brochure':
                config = `Format: ${result.details.format} - ${result.details.pages} Pages\nFinition: ${result.details.finition}\n\nPapier Intérieur: ${result.details.papierInt}\nPapier Couverture: ${result.details.papierCov}\n>>> Impression Couv: ${result.details.impressionCov}\n>>> Finition Couv: ${result.details.pelliculage === 'Oui' ? 'AVEC Pelliculage' : 'SANS Pelliculage'}`;
                break;
            case 'livre':
                config = `Format: ${result.details.format} - ${result.details.pages} Pages\nReliure: ${result.details.reliure}\n\nPapier Intérieur: ${result.details.papierInt}\nPapier Couverture: ${result.details.papierCov}\n>>> Impression Couv: ${result.details.impressionCov}\n>>> Finition Couv: ${result.details.pelliculage === 'Oui' ? 'AVEC Pelliculage' : 'SANS Pelliculage'}`;
                break;
            case 'affiches':
                config = `Grand Format ${result.details.format}\nPapier: ${result.details.papier}`;
                break;
        }

        if (paoOptions && paoOptions.type !== 'none' && result.paoDetails) {
            config += `\n\n[OPTION GRAPHIQUE]: ${result.paoDetails.description}`;
        }

        return config;
    }
};

// Auto-initialisation si chargé dans un module
if (typeof window !== 'undefined') {
    window.PricingEngine = PricingEngine;
}

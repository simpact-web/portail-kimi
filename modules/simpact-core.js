/**
 * SIMPACT CORE v2.0
 * Cœur du système : Authentification, Données, Synchronisation Cloud
 */

const SimpactCore = {
    // Configuration Cloud (à remplacer par votre URL Google Apps Script)
    CLOUD_API_URL: "https://script.google.com/macros/s/AKfycbx7IEuFfAaE6AMJ_rm9jHOa5A41OsyvzxJrWc_9vxgMBrQHYjIUNTkgtGISiyA5ceiQ/exec",
    
    // Utilisateurs par défaut (seront remplacés par localStorage si modifiés)
    DEFAULT_USERS: [
        { id: 'youssef', pass: 'ni3Shaey', role: 'superadmin', name: 'Youssef (PDG)', redirect: 'dashboard.html' },
        { id: 'admin01', pass: 'simpact2026', role: 'admin', name: 'Admin Simpact', redirect: 'dashboard.html' },
        { id: 'prod01', pass: 'atelier', role: 'production', name: 'Chef Atelier', redirect: 'pages/production.html' },
        { id: 'compta01', pass: 'facture', role: 'compta', name: 'Service Compta', redirect: 'pages/compta.html' },
        { id: 'comm01', pass: 'vente', role: 'commercial', name: 'Commercial 1', redirect: 'pages/commercial.html' },
        { id: 'client01', pass: 'client123', role: 'client', name: 'Agence Pub', redirect: 'pages/client.html' },
        { id: 'client02', pass: '1234', role: 'client', name: 'Restaurant Le Chef', redirect: 'pages/client.html' }
    ],

    /**
     * AUTHENTIFICATION
     */
    auth: {
        login(userId, password) {
            if (!userId || !password) return null;
            
            const users = this.getAllUsers();
            const foundUser = users.find(u => 
                u.id.toLowerCase() === userId.toLowerCase() && u.pass === password
            );
            
            if (foundUser) {
                localStorage.setItem('SIMPACT_USER', JSON.stringify(foundUser));
                return foundUser;
            }
            return null;
        },

        logout() {
            localStorage.removeItem('SIMPACT_USER');
            window.location.href = '../index.html';
        },

        checkAuth(allowedRoles) {
            const session = localStorage.getItem('SIMPACT_USER');
            if (!session) {
                window.location.href = '../index.html';
                return null;
            }

            try {
                const user = JSON.parse(session);
                
                // Superadmin a accès à tout
                if (user.role === 'superadmin') return user;
                
                if (!allowedRoles) return user;

                const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
                
                if (!roles.includes(user.role)) {
                    alert("⛔ Accès interdit à cette zone !");
                    window.location.href = user.redirect;
                    return null;
                }

                return user;
            } catch (e) {
                this.logout();
                return null;
            }
        },

        getCurrentUser() {
            const session = localStorage.getItem('SIMPACT_USER');
            return session ? JSON.parse(session) : null;
        },

        getAllUsers() {
            const saved = localStorage.getItem('SIMPACT_USERS');
            return saved ? JSON.parse(saved) : [...SimpactCore.DEFAULT_USERS];
        },

        saveUser(userData) {
            const users = this.getAllUsers();
            const existingIndex = users.findIndex(u => u.id === userData.id);
            
            if (existingIndex >= 0) {
                users[existingIndex] = userData;
            } else {
                users.push(userData);
            }
            
            localStorage.setItem('SIMPACT_USERS', JSON.stringify(users));
            return true;
        },

        deleteUser(userId) {
            if (userId === 'youssef') return false; // Protection superadmin
            
            let users = this.getAllUsers();
            users = users.filter(u => u.id !== userId);
            localStorage.setItem('SIMPACT_USERS', JSON.stringify(users));
            return true;
        }
    },

    /**
     * GESTION DES COMMANDES
     */
    orders: {
        getAll() {
            try {
                return JSON.parse(localStorage.getItem('SIMPACT_ORDERS')) || [];
            } catch (e) {
                return [];
            }
        },

        getByRef(ref) {
            return this.getAll().find(o => o.ref === ref);
        },

        getByStatus(status, type = 'prod') {
            const orders = this.getAll();
            if (type === 'prod') {
                return orders.filter(o => o.statusProd === status);
            }
            return orders.filter(o => o.statusCompta === status);
        },

        save(orderData) {
            let orders = this.getAll();
            
            // Éviter les doublons (même référence)
            orders = orders.filter(o => o.ref !== orderData.ref);
            orders.unshift(orderData);
            
            // Limite de 100 commandes locales
            if (orders.length > 100) orders.pop();
            
            localStorage.setItem('SIMPACT_ORDERS', JSON.stringify(orders));
            
            // Synchronisation cloud (silencieuse)
            this.syncToCloud(orderData);
            
            // Notification temps réel
            if (typeof BroadcastChannel !== 'undefined') {
                const channel = new BroadcastChannel('simpact_orders');
                channel.postMessage({ type: 'NEW_ORDER', order: orderData });
            }
            
            return orderData;
        },

        updateStatus(ref, newStatus, type = 'prod') {
            let orders = this.getAll();
            const order = orders.find(o => o.ref === ref);
            
            if (order) {
                if (type === 'prod') order.statusProd = newStatus;
                if (type === 'compta') order.statusCompta = newStatus;
                order.lastModified = new Date().toISOString();
                
                localStorage.setItem('SIMPACT_ORDERS', JSON.stringify(orders));
                this.syncToCloud(order);
                
                // Notification
                if (typeof BroadcastChannel !== 'undefined') {
                    const channel = new BroadcastChannel('simpact_orders');
                    channel.postMessage({ 
                        type: 'STATUS_UPDATE', 
                        ref, 
                        status: newStatus, 
                        statusType: type 
                    });
                }
                
                return true;
            }
            return false;
        },

        generateRef() {
            return 'D-' + Date.now().toString().slice(-6);
        },

        // Synchronisation vers Google Sheets (silencieuse)
        syncToCloud(orderData) {
            if (!SimpactCore.CLOUD_API_URL || !SimpactCore.CLOUD_API_URL.startsWith('http')) {
                return;
            }

            const formData = new FormData();
            formData.append('Date', orderData.date);
            formData.append('Ref', orderData.ref);
            formData.append('Client', orderData.client);
            formData.append('Produit', orderData.prod);
            formData.append('Quantité', orderData.qty);
            formData.append('Prix HT', orderData.price);
            formData.append('Détails', orderData.desc);
            formData.append('Commercial', orderData.user);
            formData.append('Statut_Prod', orderData.statusProd);
            formData.append('Statut_Compta', orderData.statusCompta);

            fetch(SimpactCore.CLOUD_API_URL, { 
                method: 'POST', 
                body: formData, 
                mode: 'no-cors' 
            }).catch(() => {});
        },

        // Récupération depuis le cloud (toutes les 5 secondes)
        async syncFromCloud() {
            if (!SimpactCore.CLOUD_API_URL || !SimpactCore.CLOUD_API_URL.startsWith('http')) {
                return;
            }

            try {
                const response = await fetch(SimpactCore.CLOUD_API_URL);
                const cloudData = await response.json();
                
                if (Array.isArray(cloudData)) {
                    // Fusion intelligente : cloud est prioritaire
                    localStorage.setItem('SIMPACT_ORDERS', JSON.stringify(cloudData));
                    
                    // Notification de mise à jour
                    if (typeof BroadcastChannel !== 'undefined') {
                        const channel = new BroadcastChannel('simpact_orders');
                        channel.postMessage({ type: 'SYNC_COMPLETE', count: cloudData.length });
                    }
                }
            } catch (e) {
                console.log('Sync cloud indisponible');
            }
        }
    },

    /**
     * GESTION DES DEVIS (NOUVEAU)
     */
    quotes: {
        getAll() {
            try {
                return JSON.parse(localStorage.getItem('SIMPACT_QUOTES')) || [];
            } catch (e) {
                return [];
            }
        },

        save(quoteData) {
            let quotes = this.getAll();
            quotes = quotes.filter(q => q.ref !== quoteData.ref);
            quotes.unshift(quoteData);
            
            if (quotes.length > 50) quotes.pop();
            
            localStorage.setItem('SIMPACT_QUOTES', JSON.stringify(quotes));
            return quoteData;
        },

        convertToOrder(quoteRef) {
            const quotes = this.getAll();
            const quote = quotes.find(q => q.ref === quoteRef);
            
            if (!quote) return null;
            
            // Créer la commande
            const order = {
                ...quote,
                ref: SimpactCore.orders.generateRef(),
                type: 'ORDER',
                statusProd: 'En attente',
                statusCompta: 'Non payé',
                convertedFrom: quoteRef,
                date: new Date().toLocaleDateString()
            };
            
            SimpactCore.orders.save(order);
            
            // Marquer le devis comme converti
            quote.status = 'converted';
            quote.convertedTo = order.ref;
            this.save(quote);
            
            return order;
        },

        updateStatus(ref, newStatus) {
            let quotes = this.getAll();
            const quote = quotes.find(q => q.ref === ref);
            
            if (quote) {
                quote.status = newStatus;
                quote.lastModified = new Date().toISOString();
                localStorage.setItem('SIMPACT_QUOTES', JSON.stringify(quotes));
                return true;
            }
            return false;
        },

        generateRef() {
            return 'Q-' + Date.now().toString().slice(-6);
        }
    },

    /**
     * GESTION DU STOCK (Intégration)
     */
    stock: {
        getAll() {
            try {
                return JSON.parse(localStorage.getItem('SIMPACT_STOCK')) || [];
            } catch (e) {
                return [];
            }
        },

        getMovements() {
            try {
                return JSON.parse(localStorage.getItem('SIMPACT_STOCK_MOVEMENTS')) || [];
            } catch (e) {
                return [];
            }
        },

        getStats() {
            const stock = this.getAll();
            const stats = {
                totalTypes: stock.length,
                totalQty: 0,
                totalValue: 0,
                alerts: 0
            };

            stock.forEach(paper => {
                stats.totalQty += paper.qty;
                stats.totalValue += (paper.qty * (paper.price || 0));
                
                const percentage = (paper.qty / paper.threshold) * 100;
                if (percentage <= 100) stats.alerts++;
            });

            return stats;
        },

        checkAlerts() {
            const stock = this.getAll();
            return stock.filter(paper => {
                const percentage = (paper.qty / paper.threshold) * 100;
                return percentage <= 100;
            });
        }
    },

    /**
     * STATISTIQUES GLOBALES
     */
    stats: {
        getRevenue(period = 'all') {
            const orders = SimpactCore.orders.getAll();
            let filtered = orders;
            
            if (period === 'today') {
                const today = new Date().toLocaleDateString();
                filtered = orders.filter(o => o.date === today);
            } else if (period === 'month') {
                const currentMonth = new Date().getMonth();
                const currentYear = new Date().getFullYear();
                filtered = orders.filter(o => {
                    const d = new Date(o.date);
                    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
                });
            }
            
            return filtered.reduce((sum, o) => sum + parseFloat(o.price || 0), 0);
        },

        getProductionQueue() {
            return SimpactCore.orders.getByStatus('En attente', 'prod');
        },

        getTodayCompleted() {
            const today = new Date().toLocaleDateString();
            return SimpactCore.orders.getAll().filter(o => 
                o.date === today && o.statusProd === 'Terminé'
            );
        }
    },

    /**
     * UTILITAIRES
     */
    utils: {
        formatPrice(amount) {
            return parseFloat(amount).toFixed(2) + ' DT';
        },

        formatDate(date = new Date()) {
            return date.toLocaleDateString('fr-FR');
        },

        debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }
    }
};

// Auto-sync cloud toutes les 5 secondes
setInterval(() => SimpactCore.orders.syncFromCloud(), 5000);

// Exposition globale
window.SimpactCore = SimpactCore;
window.login = (u, p) => SimpactCore.auth.login(u, p);
window.logout = () => SimpactCore.auth.logout();
window.checkAuth = (roles) => SimpactCore.auth.checkAuth(roles);
window.getOrders = () => SimpactCore.orders.getAll();
window.saveOrder = (o) => SimpactCore.orders.save(o);
window.updateOrderStatus = (r, s, t) => SimpactCore.orders.updateStatus(r, s, t);
window.getAllUsers = () => SimpactCore.auth.getAllUsers();
window.saveUser = (u) => SimpactCore.auth.saveUser(u);
window.deleteUser = (id) => SimpactCore.auth.deleteUser(id);

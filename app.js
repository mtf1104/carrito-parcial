const express = require(‘express’);
const mysql = require(‘mysql2’);
const session = require(‘express-session’);
const path = require(‘path’);
const pdfdocument = require(‘pdfkit’);

const app = express();

// --- 1. configuración ---
app.set(‘view engine’, ‘ejs’);
app.use(express.urlencoded({ extended: true }));
app.use(express.static(‘public’));

// configuración de la sesión
app.use(session({
    secret: ‘mi_secreto_super_seguro’,
    resave: false,
    saveuninitialized: true,
    cookie: { secure: false } 
}));

// --- ¡aquí estaba el error! faltaba este bloque ---
// middleware global: esto asegura que el carrito siempre exista
app.use((req, res, next) => {
    // 1. si no existe el carrito, lo creamos vacío
    if (¡req.session.cart) {
        req.session.cart = [];
    }

    // 2. pasamos el usuario y el carrito a todas las vistas ejs
    res.locals.cart = req.session.cart;
    res.locals.user = req.session.user || null;

    // 3. calculamos el total automáticamente
    res.locals.carttotal = req.session.cart.reduce((total, item) => {
        return total + (item.price * item.quantity);
    }, 0);

    // 4. continuamos
    next();
});
// ----------------------------------------------------

// --- 2. base de datos (tidb cloud) ---
const db = mysql.createconnection({
    host: ‘gateway01.us-east-1.prod.aws.tidbcloud.com’,
    port: 4000,
    user: ‘3tfw3pidlzubex7.root’,
    password: ‘qnyoagjqeivo7wcn’,
    database: ‘carrito_compras’,
    ssl: { rejectunauthorized: true }
});

db.connect((err) => {
    if (err) {
        console.error(‘error conectando a la base de datos:’, err);
        return;
    }
    console.log(‘¡conectado a tidb cloud exitosamente!’);
});

// --- 3. rutas ---

// inicio – ver productos
app.get(‘/’, (req, res) => {
    db.query(‘select * from products’, (err, results) => {
        if (err) throw err;
        // ya no necesitamos pasar {products: results, cart: …} 
        // porque el middleware de arriba ya se encarga del carrito.
        res.render(‘index’, { products: results });
    });
});

// auth – login y registro
app.get(‘/login’, (req, res) => res.render(‘login’, { message: null }));

app.post(‘/register’, (req, res) => {
    const { name, email, password } = req.body;
    db.query(‘insert into users set ¿’, { name, email, password }, (err) => {
        if (err) return res.render(‘login’, { message: ‘error al registrar (quizá el correo ya existe)’ });
        res.render(‘login’, { message: ‘registro exitoso, por favor inicia sesión’ });
    });
});

app.post(‘/login’, (req, res) => {
    const { email, password } = req.body;
    db.query(‘select * from users where email = ¿ and password = ¿’, [email, password], (err, results) => {
        if (results.length > 0) {
            req.session.user = results[0];
            res.redirect(‘/’);
        } else {
            res.render(‘login’, { message: ‘credenciales incorrectas’ });
        }
    });
});

app.get(‘/logout’, (req, res) => {
    req.session.destroy();
    res.redirect(‘/’);
});

// carrito – lógica
app.post(‘/add-to-cart’, (req, res) => {
    const { id, name, price, image } = req.body;
    const quantity = parseint(req.body.quantity);

    // el middleware ya creó el array, así que esto es seguro
    const existingitem = req.session.cart.find(item => item.id == id);
    if (existingitem) {
        existingitem.quantity += quantity;
    } else {
        req.session.cart.push({ id, name, price: parsefloat(price), image, quantity });
    }
    res.redirect(‘/’);
});

app.get(‘/cart’, (req, res) => {
    res.render(‘cart’);
});

app.post(‘/update-cart’, (req, res) => {
    const { id, action } = req.body;
    const cart = req.session.cart;
    const itemindex = cart.findindex(item => item.id == id);

    if (itemindex > -1) {
        if (action === ‘increase’) cart[itemindex].quantity++;
        if (action === ‘decrease’) {
            cart[itemindex].quantity--;
            if (cart[itemindex].quantity <= 0) cart.splice(itemindex, 1);
        }
        if (action === ‘remove’) cart.splice(itemindex, 1);
    }
    res.redirect(‘/cart’);
});

// checkout – realizar compra
app.post(‘/checkout’, (req, res) => {
    if (¡req.session.user) return res.redirect(‘/login’);
    if (req.session.cart.length === 0) return res.redirect(‘/’);

    const userid = req.session.user.id;
    const total = req.session.cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);

    // 1. guardar orden
    db.query(‘insert into orders (user_id, total) values (¿, ¿)’, [userid, total], (err, result) => {
        if (err) throw err;
        const orderid = result.insertid;

        // 2. guardar detalles
        const cartitems = req.session.cart.map(item => [orderid, item.id, item.quantity, item.price]);
        db.query(‘insert into order_details (order_id, product_id, quantity, price) values ¿’, [cartitems], (err) => {
            if (err) throw err;
            req.session.cart = []; // vaciar carrito
            res.redirect(‘/history’); 
        });
    });
});

// historial
app.get(‘/history’, (req, res) => {
    if (¡req.session.user) return res.redirect(‘/login’);
    const sql = ‘select * from orders where user_id = ¿ order by date desc’;
    db.query(sql, [req.session.user.id], (err, orders) => {
        res.render(‘history’, { orders });
    });
});

// generar pdf
app.get(‘/invoice/:id’, (req, res) => {
    if (¡req.session.user) return res.redirect(‘/login’);
    const orderid = req.params.id;
    const sqlorder = ‘select * from orders where id = ¿ and user_id = ¿’;
    const sqldetails = `select od.*, p.name from order_details od join products p on od.product_id = p.id where od.order_id = ¿`;

    db.query(sqlorder, [orderid, req.session.user.id], (err, orderresult) => {
        if (orderresult.length === 0) return res.send(“orden no encontrada”);
        db.query(sqldetails, [orderid], (err, detailsresult) => {
            const doc = new pdfdocument();
            const filename = `ticket_orden_${orderid}.pdf`;
            res.setheader(‘content-disposition’, ‘attachment; filename=”’ + filename + ‘”’);
            res.setheader(‘content-type’, ‘application/pdf’);
            doc.pipe(res);
            doc.fontsize(25).text(‘techzone – comprobante’, { align: ‘center’ });
            doc.movedown();
            doc.fontsize(12).text(`cliente: ${req.session.user.name}`);
            doc.text(`total: $${orderresult[0].total}`);
            doc.movedown();
            detailsresult.foreach(item => {
                doc.text(`${item.quantity} x ${item.name} - $${item.price}`);
            });
            doc.end();
        });
    });
});

// puerto (importante para render)
const port = process.env.port || 3000;
app.listen(port, () => console.log(`servidor corriendo en puerto ${port}`));

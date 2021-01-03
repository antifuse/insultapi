import express = require("express");
import { Sequelize, DataTypes, SequelizeScopeError, Op } from "sequelize";
import * as winston from "winston";
import { Insult } from "./InsultModel";
import { Submitter } from "./SubmitterModel";
import * as fs from "fs";
import * as stringSimilarity from "string-similarity";
import { Where } from "sequelize/types/lib/utils";
const app = express();
app.use(express.json({ type: '*/*' }));
app.use(express.urlencoded({extended: true}));
app.use((req, res, next) => {
    let body = isEmptyObject(req.body) ? req.query : req.body;
    req.body = body;
    res.setHeader("Access-Control-Allow-Origin","*");
    log.info(`Received ${req.path} request from IP ${req.ip}. Processing...`);
    next();
});

const log = winston.createLogger({
    format: winston.format.combine(winston.format.timestamp({ format: "DD.MM. HH:mm:ss" }), winston.format.printf(info => `${info.timestamp} ${info.level} | ${info.message}`)),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: "api.log" }),
        new winston.transports.File({ filename: "debug.log", level: "debug" })
    ]
});
let config: { database: string, port: number };
config = JSON.parse(fs.readFileSync("./config.json", { encoding: "utf-8" }));

const sequelize = new Sequelize(config.database, { logging: log.debug.bind(log) });

Submitter.init({
    sid: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    userid: DataTypes.STRING,
    free: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    authcode: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        allowNull: false,
        unique: true
    }
}, {
    sequelize,
    tableName: 'submitter',
    timestamps: true,
    createdAt: false,
    updatedAt: 'registeredat'
});

Insult.init({
    iid: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    content: DataTypes.STRING(4096),
    used: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
    },
    by: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
}, {
    sequelize,
    tableName: 'insult',
    timestamps: true,
    updatedAt: 'lastused',
    createdAt: 'createdat'
});

Submitter.hasMany(Insult, {
    as: "insults",
    foreignKey: "by"
});

const submitterQueryAttrs = [["sid", "number"], ["userid", "string"], ["free", "boolean"], ["authcode", "string"]];
const insultQueryAttrs = [["iid", "number"], ["content", "string"], ["used", "number"], ["by", "number"]];

app.get("/api/generateKeys", (req, res) => {
    let count = req.body.count || 1;
    let keys: string[] = [];
    (async () => {
        for (let i = 0; i < count; i++) {
            let sub = await Submitter.create();
            keys.push(sub.authcode);
            log.info(`Generated code ${sub.authcode} with ID ${sub.sid}.`);
        }
    })().then(() => {
        res.send(keys);
    }).catch((err) => {
        log.error(err);
        res.sendStatus(500);
    });
});

app.get("/api/submitters", (req, res) => {
    Submitter.findAll({ where: toQuery(req.body, submitterQueryAttrs) }).then((results) => {
        if (results.length == 0) res.sendStatus(404);
        else res.send(results);
    }).catch((reason) => {
        log.error(reason);
        res.sendStatus(500);
    })
});

app.get("/api/submitters/:userid", (req, res) => {
    Submitter.findOne({ where: { userid: req.params.userid }}).then((result) => {
        if (result == null) res.sendStatus(404);
        else res.send(result);
    }).catch((reason) => {
        log.error(reason);
        res.sendStatus(500);
    });
});

app.post("/api/submitters/:userid/addInsult", (req, res) => {
    if (!req.body.content) res.sendStatus(400);
    else {
        Submitter.findOne({ where: { userid: req.params.userid } }).then((value) => {
            if (value == null) res.sendStatus(404);
            else {
                Insult.findAll().then((insults) => {
                    let similarity = stringSimilarity.findBestMatch(req.body.content.toLowerCase(), insults.map((element) => element.content.toLowerCase()));
                    if (similarity.bestMatch.rating > 0.8) {
                        res.status(409).send(similarity.bestMatch.target);
                    } else {
                        value.createInsult({ content: req.body.content }).then((newResource) => {
                            res.send(newResource);
                        });
                    }
                });
            }
        }).catch((reason) => {
            log.error(reason);
            res.sendStatus(500);
        });
    }
});

app.post("/api/insults", (req, res) => {
    if (!req.body.content) res.sendStatus(400);
    Insult.findAll().then((insults) => {
        let similarity = stringSimilarity.findBestMatch(req.body.content.toLowerCase(), insults.map((element) => element.content.toLowerCase()));
        if (similarity.bestMatch.rating > 0.8) {
            res.status(409).send(similarity.bestMatch.target);
        } else {
            Insult.create({ content: req.body.content, by: req.body.by || null }).then((newResource) => {
                res.status(201).header("Location", "/api/insults/" + newResource.iid).send(newResource);
            });
        }
    }).catch((reason)=>{
        log.error(reason);
        res.sendStatus(500);
    });
});

app.get("/api/insults", (req, res) => {
    Insult.findAll({ where: toQuery(req.body, insultQueryAttrs) }).then((results) => {
        if (results.length == 0) res.sendStatus(404);
        else res.send(results);
    }).catch((reason) => {
        res.sendStatus(500);
    })
});

app.get("/api/insults/:iid", (req, res) => {
    Insult.findOne({ where: { iid: req.params.iid } }).then((result) => {
        if (result == null) res.sendStatus(404);
        else res.send(result);
    }).catch((reason) => {
        res.sendStatus(500);
    });
});

app.delete("/api/insults/:iid", (req, res) => {
    Insult.findOne({ where: { iid: req.params.iid } }).then((result) => {
        if (result == null) res.sendStatus(404);
        else result.destroy().then(() => res.sendStatus(204));
    }).catch((reason) => {
        res.sendStatus(500);
    });
});

app.get("/makeCoffee", (req, res) => {
    res.sendStatus(418);
});

app.listen(config.port, () => { console.log("Listening!") });

function isEmptyObject(obj: any) {
    for (let i in obj) return false;
    return true;
}

function toQuery(body: any, queryParams: string[][]) {
    let query: any = {};
    for (let key in body) {
        let param = queryParams.find((element)=> element[0] == key)
        if (param) {
            if (body[key] == null) query[key] = null;
            else if (param[1] == "string") query[key] = {[Op.iLike]: body[key]};
            else if (param[1] == "number") {if(!isNaN(parseInt(body[key]))) query[key] = body[key];}
            else if (param[1] == "boolean") { 
                let val = typeof body[key] == "boolean" ? body[key] : body[key] == "true" ? true : body[key] == "false" ? false : body[key] == "null" ? null : undefined;
                if (val !== undefined) query[key] = val;
            } 
            else query[key] = body[key];
        }
    }
    return query;
}
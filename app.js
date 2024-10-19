const express = require('express')
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
let db = null
const app = express()
app.use(express.json())
const dbPath = path.join(__dirname, 'twitterClone.db')

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}

initializeDBAndServer()

const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'abcdefgh', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.user = payload
        next()
      }
    })
  }
}

app.post('/register/', async (request, response) => {
  try {
    const {username, password, name, gender} = request.body
    const hashedPassword = await bcrypt.hash(password, 10)
    const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`
    const dbUser = await db.get(selectUserQuery)
    if (dbUser === undefined) {
      if (password.length < 6) {
        response.status(400)
        response.send('Password is too short')
      } else {
        const createUserQuery = `
          INSERT INTO 
            user (username, password, name, gender)
          VALUES 
            (
              '${username}',
              '${hashedPassword}',
              '${name}',
              '${gender}'
            );`
        await db.run(createUserQuery)
        response.status(200)
        response.send('User created successfully')
      }
    } else {
      response.status(400)
      response.send('User already exists')
    }
  } catch (error) {
    response.status(500)
    response.send(`Server Error ${error}`)
  }
})

app.post('/login', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {username: username}
      const jwtToken = jwt.sign(payload, 'abcdefgh')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  try {
    const {username} = request.user
    const selectFollowingQuery = `
        SELECT following_user_id 
        FROM follower
        WHERE follower_user_id = (SELECT user_id FROM user WHERE username = ?);
      `
    const following = await db.all(selectFollowingQuery, [username])
    if (following.length === 0) {
      return response.status(404).send('No followings found')
    }

    const followingIds = following.map(user => user.following_user_id)
    const getTweetsQuery = `
        SELECT user.username, tweet.tweet, tweet.date_time as dateTime
        FROM tweet
        INNER JOIN user ON tweet.user_id = user.user_id
        WHERE tweet.user_id IN (${followingIds.map(() => '?').join(',')})
        ORDER BY tweet.date_time DESC
        LIMIT 4;
      `

    const tweets = await db.all(getTweetsQuery, followingIds)
    response.status(200).send(tweets)
  } catch (error) {
    console.error(error.message)
    response.status(500).send('Server Error')
  }
})

app.get('/user/following/', authenticateToken, async (request, response) => {
  const {username} = request.user
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserIdQuery)
  if (!dbUser) {
    return response.status(404).send('User not found')
  }
  const getFollowingQuery = `
    SELECT user.name
    FROM follower
    INNER JOIN user
    ON user.user_id = follower.following_user_id
    WHERE follower.follower_user_id = '${dbUser.user_id}';
  `
  const following = await db.all(getFollowingQuery)
  const followingNames = following.map(person => ({name: person.name}))
  response.send(followingNames)
})

app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {username} = request.user
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserIdQuery)
  if (!dbUser) {
    return response.status(404).send('User not found')
  }
  const getFollowersQuery = `
    SELECT user.name
    FROM follower
    INNER JOIN user
    ON user.user_id = follower.follower_user_id
    WHERE follower.following_user_id = '${dbUser.user_id}';
  `
  const followers = await db.all(getFollowersQuery)
  const followersNames = followers.map(person => ({name: person.name}))
  response.send(followersNames)
})

app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const {username} = request.user
  const {tweetId} = request.params
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserIdQuery)
  if (!dbUser) {
    return response.status(404).send('User not found')
  }
  const checkFollowingQuery = `
    SELECT 1 
    FROM tweet 
    INNER JOIN follower 
    ON tweet.user_id = follower.following_user_id 
    WHERE tweet.tweet_id = '${tweetId}'
    AND follower.follower_user_id = '${dbUser.user_id}';`
  const isFollowing = await db.get(checkFollowingQuery)
  if (!isFollowing) {
    return response.status(401).send('Invalid Request')
  }
  const getTweetDetailsQuery = `
    SELECT 
      tweet.tweet,
      COUNT(DISTINCT like.like_id) AS likes,
      COUNT(DISTINCT reply.reply_id) AS replies,
      tweet.date_time AS dateTime
    FROM tweet
    LEFT JOIN like on tweet.tweet_id = like.tweet_id
    LEFT JOIN reply on tweet.tweet_id = reply.tweet_id  
    WHERE tweet.tweet_id = '${tweetId}';  
  `
  const tweetDetails = await db.get(getTweetDetailsQuery)
  response.send(tweetDetails)
})

app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  async (request, response) => {
    const {username} = request.user
    const {tweetId} = request.params
    const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`
    const dbUser = await db.get(getUserIdQuery)
    if (!dbUser) {
      return response.status(404).send('User not found')
    }
    const checkFollowingQuery = `
    SELECT 1 
    FROM tweet 
    INNER JOIN follower 
    ON tweet.user_id = follower.following_user_id 
    WHERE tweet.tweet_id = '${tweetId}'
    AND follower.follower_user_id = '${dbUser.user_id}';`
    const isFollowing = await db.get(checkFollowingQuery)
    if (!isFollowing) {
      return response.status(401).send('Invalid Request')
    }
    const getLikeDetailsQuery = `
    SELECT user.username
    FROM like
    INNER JOIN user on like.user_id = user.user_id
    WHERE like.tweet_id = '${tweetId}';  
  `
    const likeDetails = await db.all(getLikeDetailsQuery)
    const userNames = likeDetails.map(like => like.username)
    response.send({likes: userNames})
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  async (request, response) => {
    const {username} = request.user
    const {tweetId} = request.params
    const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`
    const dbUser = await db.get(getUserIdQuery)
    if (!dbUser) {
      return response.status(404).send('User not found')
    }
    const checkFollowingQuery = `
    SELECT 1 
    FROM tweet 
    INNER JOIN follower 
    ON tweet.user_id = follower.following_user_id 
    WHERE tweet.tweet_id = '${tweetId}'
    AND follower.follower_user_id = '${dbUser.user_id}';`
    const isFollowing = await db.get(checkFollowingQuery)
    if (!isFollowing) {
      return response.status(401).send('Invalid Request')
    }
    const getReplyDetailsQuery = `
    SELECT user.name, reply.reply
    FROM reply
    INNER JOIN user on reply.user_id = user.user_id 
    WHERE reply.tweet_id = '${tweetId}';  
  `
    const replyDetails = await db.all(getReplyDetailsQuery)
    response.send({replies: replyDetails})
  },
)

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request.user
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserIdQuery)
  if (!dbUser) {
    return response.status(404).send('User not found')
  }
  const getTweetQuery = `
    SELECT 
      tweet.tweet,
      (SELECT COUNT(*) FROM like WHERE like.tweet_id = tweet.tweet_id) AS likes,
      (SELECT COUNT(*) FROM reply WHERE reply.tweet_id = tweet.tweet_id) AS replies,
      tweet.date_time AS dateTime
    FROM tweet 
    WHERE tweet.user_id = '${dbUser.user_id}';     
  `
  const tweets = await db.all(getTweetQuery)
  response.send(tweets)
})

app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request.user
  const {tweet} = request.body
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserIdQuery)
  if (!dbUser) {
    return response.status(404).send('User not found')
  }
  const createTweetQuery = `
    INSERT INTO tweet (tweet, user_id, date_time)
    VALUES (
      '${tweet}',
      '${dbUser.user_id}',
      datetime('now')
    );`
  await db.run(createTweetQuery)
  response.send('Created a Tweet')
})

app.delete('/tweets/:tweetId', authenticateToken, async (request, response) => {
  const {username} = request.user
  const {tweetId} = request.params
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserIdQuery)
  const getTweetQuery = `SELECT * FROM tweet WHERE tweet_id = '${tweetId}';`
  const tweet = await db.get(getTweetQuery)

  if (!tweet) {
    return response.status(404).send('Tweet Not Found')
  }

  if (tweet.user_id !== dbUser.user_id) {
    return response.status(401).send('Invalid Request')
  }
  const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = '${tweetId}';`
  await db.run(deleteTweetQuery)
  response.status(200)
  response.send('Tweet Removed')
})

module.exports = app

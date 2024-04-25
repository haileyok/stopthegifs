import {
  AppBskyEmbedExternal,
  AppBskyEmbedImages, AppBskyEmbedRecord, AppBskyEmbedRecordWithMedia,
  AppBskyFeedDefs,
  AppBskyFeedPost,
  BskyAgent,
} from '@atproto/api'
import * as dotenv from 'dotenv'
import {ComAtprotoSyncSubscribeRepos, subscribeRepos, SubscribeReposMessage} from 'atproto-firehose'

dotenv.config()

const agent = new BskyAgent({
  service: 'https://bsky.social/',
})

const login = async () => {
  await agent.login({
    identifier: process.env.BSKY_HANDLE ?? '',
    password: process.env.BSKY_PASSWORD ?? '',
  })
}

const emitLabel = async (uri: string, cid: string) => {
  try {
    await agent.withProxy('atproto_labeler', 'did:plc:mjyeurqmqjeexbgigk3yytvb').api.tools.ozone.moderation.emitEvent({
      event: {
        $type: 'tools.ozone.moderation.defs#modEventLabel',
        createLabelVals: ['tenor-gif'],
        negateLabelVals: [],
      },
      subject: {
        $type: 'com.atproto.repo.strongRef',
        uri,
        cid,
      },
      createdBy: agent.session?.did ?? '',
      createdAt: new Date().toISOString(),
      subjectBlobCids: [],
    }) 
  } catch (e: any) {
    console.log(e)
  }
}

const handleMessage =  (message: SubscribeReposMessage): void => {
    if (ComAtprotoSyncSubscribeRepos.isCommit(message)) {
      const repo = message.repo
      const op = message.ops[0]

      if (!AppBskyFeedPost.isRecord(op?.payload)) {
        return
      }

      const uri = `at://${repo}/${op.path}`
      const cid = op.cid?.toString()

      if (!cid) return

      try {
        if (AppBskyEmbedExternal.isMain(op.payload.embed) && op.payload.embed.external.uri.includes("media.tenor.com")) {
          emitLabel(uri, cid)
          console.log(`Labeled ${uri}`)
        }
      } catch(e) {
        console.log('Failed on regular')
        console.log(uri)
      }

      try {
        // @ts-ignore I'm lazy here
        if (AppBskyEmbedRecordWithMedia.isMain(op.payload.embed) && op.payload.embed.media.external?.uri.includes("media.tenor.com")) {
          emitLabel(uri, cid)
          console.log(`Labeled ${uri}`)
        }
      } catch(e) {
        console.log('Failed on other')
        console.log(uri)
      }
    }
}

const run = async () => {
  await login()
  
  const firehose = subscribeRepos('wss://bsky.network', {
    decodeRepoOps: true,
  })
  firehose.on('message', handleMessage)
}

run()

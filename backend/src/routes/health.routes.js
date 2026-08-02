const express = require('express')

const supabase = require('../config/supabase')

const router = express.Router()

router.get('/', async (request, response, next) => {
  void request

  try {
    const { error } = await supabase
      .from('batches')
      .select('id', { count: 'exact', head: true })

    if (error) {
      throw error
    }

    response.json({
      success: true,
      services: {
        api: 'healthy',
        database: 'healthy',
      },
    })
  } catch (error) {
    next(error)
  }
})

module.exports = router
